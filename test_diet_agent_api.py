import asyncio
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import diet_agent_api as api


def profile(**updates):
    data = dict(name="Test User", age=35, sex="female", location={"latitude": 18.5, "longitude": 73.8}, consent_to_process=True)
    data.update(updates)
    return api.DietRequest(**data)


@pytest.mark.parametrize("updates", [{"age": 0}, {"age": "35"}, {"sex": "invalid"}, {"name": " "}, {"location": {"latitude": 12}}, {"location": {"latitude": float('nan'), "longitude": 10}}, {"allergies": [""]}])
def test_validation(updates):
    with pytest.raises(ValidationError): profile(**updates)


def test_clinical_and_consent_guards_do_not_call_providers():
    agent = api.DietAgent(None, None, api.Settings())
    result = asyncio.run(agent.run(profile(age=12), "id"))
    assert result.status == "clinician_review_required" and result.plan is None
    result = asyncio.run(agent.run(profile(medical_conditions=["kidney disease"]), "id"))
    assert result.plan is None
    with pytest.raises(api.ServiceError) as error:
        asyncio.run(agent.run(profile(consent_to_process=False), "id"))
    assert error.value.code == "CONSENT_REQUIRED"


def test_weather_and_successful_agent():
    async def run():
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(200, json={"timezone": "Asia/Kolkata", "current": {"time": "2026-10-03T10:00", "temperature_2m": 28, "apparent_temperature": 30, "relative_humidity_2m": 70, "weather_code": 3}})
        plan = api.DietPlan(summary="Balanced meals", meals=[api.Meal(meal=m, foods=["vegetables"], portions="Flexible", reason="Variety") for m in ["breakfast", "lunch", "snack", "dinner"]], hydration_guidance="Drink regularly", weather_adjustments=["Keep food refrigerated"], allergy_precautions=[], assumptions=["Weight unknown"])
        async def parse(**kwargs):
            assert "Test User" not in kwargs["input"]
            assert '"latitude"' not in kwargs["input"]
            assert kwargs["store"] is False
            return SimpleNamespace(output_parsed=plan)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            agent = api.DietAgent(api.WeatherClient(http, api.Settings()), SimpleNamespace(responses=SimpleNamespace(parse=parse)), api.Settings())
            response = await agent.run(profile(), "id")
            assert response.status == "success" and response.weather.temperature_c == 28
            assert response.location.timezone == "Asia/Kolkata"
            assert len(calls) == 1
    asyncio.run(run())


def test_weather_failure():
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"current": {}}))) as http:
            client = api.WeatherClient(http, api.Settings())
            with pytest.raises(api.ServiceError) as error:
                await client.current(api.ResolvedLocation(label="Test", latitude=0, longitude=0, timezone="auto"))
            assert error.value.code == "WEATHER_INVALID_RESPONSE"
    asyncio.run(run())


def test_api_auth_validation_and_response(monkeypatch):
    for key in ("ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "all_proxy", "https_proxy", "http_proxy"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")
    monkeypatch.setenv("API_KEY", "a" * 32)
    with TestClient(api.app) as client:
        body = profile(age=16).model_dump(mode="json")
        assert client.post("/api/v1/diet-plan", json=body).status_code == 401
        response = client.post("/api/v1/diet-plan", json=body, headers={"X-API-Key": "a" * 32})
        assert response.status_code == 200 and response.json()["status"] == "clinician_review_required"
        assert response.headers["X-Request-ID"] == response.json()["request_id"]
        response = client.post("/api/v1/diet-plan", json={**body, "age": 0}, headers={"X-API-Key": "a" * 32})
        assert response.status_code == 422 and "Test User" not in response.text


def test_ambiguous_city():
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"results": [{"country_code": "IN"}, {"country_code": "IN"}]}))) as http:
            client = api.WeatherClient(http, api.Settings())
            with pytest.raises(api.ServiceError) as error:
                await client.resolve(api.Location(city="Pune", country_code="IN"))
            assert error.value.code == "AMBIGUOUS_LOCATION"
    asyncio.run(run())


def test_model_refusal_is_not_success():
    class FakeWeather:
        async def resolve(self, location):
            return api.ResolvedLocation(label="Test", latitude=0, longitude=0, timezone="UTC")
        async def current(self, location):
            return api.Weather(observed_at="2026-10-03T10:00", temperature_c=20, feels_like_c=20, relative_humidity_percent=50, weather_code=0, condition="clear")
    async def parse(**kwargs):
        return SimpleNamespace(output_parsed=None)
    agent = api.DietAgent(FakeWeather(), SimpleNamespace(responses=SimpleNamespace(parse=parse)), api.Settings())
    with pytest.raises(api.ServiceError) as error:
        asyncio.run(agent.run(profile(), "id"))
    assert error.value.code == "LLM_NO_PLAN"


def fallback_agent(http, enabled=True):
    class FakeWeather:
        async def resolve(self, location):
            return api.ResolvedLocation(label="Test", latitude=0, longitude=0, timezone="UTC")
        async def current(self, location):
            return api.Weather(observed_at="2026-10-03T10:00", temperature_c=20, feels_like_c=20, relative_humidity_percent=50, weather_code=0, condition="clear")
    async def parse(**kwargs):
        raise api.RateLimitError('Quota exceeded', response=httpx.Response(429,request=httpx.Request('POST','https://api.openai.com')),body={'code':'insufficient_quota'})
    return api.DietAgent(FakeWeather(),SimpleNamespace(responses=SimpleNamespace(parse=parse)),api.Settings(gemini_fallback_enabled=enabled,gemini_api_key='test-google-key'),gemini_http=http)


def test_openai_rate_limit_uses_gemini():
    plan = dict(summary='Balanced', meals=[dict(meal=m,foods=['vegetables'],portions='Flexible',reason='Variety') for m in ['breakfast','lunch','snack','dinner']],hydration_guidance='Drink regularly',weather_adjustments=[],allergy_precautions=[],assumptions=['Weight unknown'])
    def handler(request):
        assert request.headers['x-goog-api-key']=='test-google-key'
        body=__import__('json').loads(request.content)
        assert body['generationConfig']['responseMimeType']=='application/json'
        assert 'Test User' not in request.content.decode()
        assert 'latitude' not in body['contents'][0]['parts'][0]['text']
        return httpx.Response(200,json={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':__import__('json').dumps(plan)}]}}]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            result=await fallback_agent(http).run(profile(),'id')
            assert result.fallback_used and result.llm_provider=='gemini' and result.plan.summary=='Balanced'
    asyncio.run(run())


@pytest.mark.parametrize('response', [httpx.Response(429),httpx.Response(200,json={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'{}'}]}}]})])
def test_both_models_fail(response):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:response)) as http:
            with pytest.raises(api.ServiceError) as error:
                await fallback_agent(http).run(profile(),'id')
            assert error.value.code=='ALL_MODELS_FAILED'
    asyncio.run(run())


def test_disabled_fallback_makes_no_google_call():
    async def run():
        def handler(r): raise AssertionError('Must not call Gemini')
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            with pytest.raises(api.ServiceError) as error:
                await fallback_agent(http,enabled=False).run(profile(),'id')
            assert error.value.code=='LLM_QUOTA_EXHAUSTED'
    asyncio.run(run())


@pytest.mark.parametrize('status,payload,code', [
    (400,{'error':{'message':'API key not valid','details':[{'reason':'API_KEY_INVALID'}]}},'GEMINI_KEY_INVALID'),
    (404,{'error':{'message':'Model unavailable'}},'GEMINI_MODEL_NOT_FOUND'),
    (403,{'error':{'message':'Permission denied'}},'GEMINI_ACCESS_DENIED'),
    (400,{'error':{'message':'Unknown field'}},'GEMINI_BAD_REQUEST'),
    (429,{'error':{}},'GEMINI_RATE_LIMITED')])
def test_gemini_error_classification(status,payload,code):
    error=api.gemini_provider_error(httpx.Response(status,json=payload))
    assert error.code==code


def test_gemini_transient_error_retries():
    async def run():
        calls=[]
        def handler(request):
            calls.append(request)
            return httpx.Response(503)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            with pytest.raises(api.ServiceError) as error:
                await fallback_agent(http).run(profile(),'id')
            assert len(calls)==2
            assert 'HTTP 503' in error.value.message
    asyncio.run(run())


def test_gemini_connection_error_is_specific():
    async def run():
        def handler(request): raise httpx.ConnectError('network failure',request=request)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            with pytest.raises(api.ServiceError) as error:
                await fallback_agent(http).run(profile(),'id')
            assert 'Cannot connect to Gemini' in error.value.message
    asyncio.run(run())
