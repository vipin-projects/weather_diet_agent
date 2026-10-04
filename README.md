# Weather-aware diet agent API

Python 3.11+ recommended. This implementation uses an asynchronous agent class,
Open-Meteo weather/geocoding and OpenAI structured output. No agent framework is
required. Change LLM_MODEL to a model supporting Responses structured output.

Flow: validated request → consent/clinical eligibility → resolve location →
fetch current weather → LLM meal plan → validated JSON response.

## Setup

Run commands from this folder:

```bash
python -m venv .venv
```

Windows PowerShell: `.venv\Scripts\Activate.ps1`

macOS/Linux: `source .venv/bin/activate`

```bash
python -m pip install -r requirements.txt
```

Copy `.env.example` to `.env`. Set OPENAI_API_KEY, and generate API_KEY:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Put the generated value into API_KEY. Never commit `.env` or share the API key.
OpenAI model calls require a separately configured API account/billing.

```bash
python diet_agent_api.py
```

Open http://127.0.0.1:8000/docs. Click **Authorize**, enter API_KEY, then use
POST /api/v1/diet-plan → Try it out → Execute. Swagger displays the response.
GET /health is an unauthenticated liveness check. No separate frontend is included.

## Example request

```json
{
  "name": "Vipin",
  "age": 40,
  "sex": "male",
  "location": {"latitude": 18.559, "longitude": 73.786},
  "dietary_preference": "vegetarian",
  "allergies": [],
  "medical_conditions": [],
  "pregnant_or_breastfeeding": false,
  "activity_level": "moderate",
  "goal": "balanced_eating",
  "consent_to_process": true
}
```

Age in this example is illustrative. Sex accepts male, female, intersex or
prefer_not_to_say. Dietary preference: vegetarian, vegan, omnivore, pescatarian.
Goal: balanced_eating, weight_management, muscle_support. Activity level:
sedentary, moderate, active. Unrecognized fields are rejected.

Alternatively supply `"location": {"city": "Pune", "country_code": "IN"}`.
Ambiguous cities return 422; use coordinates to identify the exact location.
The API cannot silently discover device GPS. A frontend must ask for browser
location permission and pass latitude/longitude. Do not use caller IP as precise
location. Coordinates take no city/country fields in the same request.

Save the example as request.json and call (replace the key):

```bash
curl -X POST http://127.0.0.1:8000/api/v1/diet-plan -H "Content-Type: application/json" -H "X-API-Key: YOUR_GENERATED_API_KEY" --data-binary @request.json
```

On PowerShell use `curl.exe`. A successful result contains request_id, name,
location, observed weather, a structured plan, assumptions and a wellness notice.
No fabricated example is represented as live model output.

## Publish with ngrok

1. Register/sign in at https://dashboard.ngrok.com/ and obtain your authtoken.
2. Set NGROK_AUTHTOKEN in `.env` and set ENABLE_NGROK=true.
3. Run `python diet_agent_api.py` (the uvicorn CLI does not start the tunnel).
4. The terminal prints the HTTPS public URL and its `/docs` URL. Keep the process
   running; stopping it closes the tunnel. The assigned URL may change on restart.
5. Call the public URL with the same X-API-Key header.

No live tunnel is created by this downloaded package until you configure and run
it. ngrok account limits apply. If tunnel startup fails, verify the token/account
and outbound internet connectivity. ngrok request inspection may contain the
profile sent in a request; configure retention/access appropriately.

## Configuration and errors

Timeouts, model, concurrency, output limit, port and provider endpoints are in
`.env.example`. All upstream calls are asynchronous. Weather retries once on
network/timeout/429/5xx. OpenAI SDK retries are disabled so a configured Gemini fallback runs promptly.
There is no fabricated plan fallback when weather or LLM fails.

Errors use `{"error":{"code":"...","message":"...","request_id":"...","details":null}}`.

| HTTP | Meaning |
|---|---|
| 401 | Missing/incorrect API key |
| 404 | Location not found |
| 422 | Invalid inputs, ambiguous city, or consent missing |
| 502 | Upstream unavailable, malformed output, refusal or provider configuration error |
| 503 | Provider rate limit or application concurrency exhausted |
| 504 | Weather/LLM timeout |
| 500 | Unexpected server error (no stack trace exposed) |

Under-18 users, disclosed medical conditions, and pregnancy/breastfeeding return
HTTP 200 with `status=clinician_review_required`, reasons, and `plan=null`.
This happens before any weather/model call. API clients must inspect status.
Adults without these disclosures receive general wellness suggestions. Age/sex
and weather alone cannot determine precise nutrition needs; no calorie target,
fixed hydration volume or therapeutic diet is generated. Weather influences
comfort, hydration reminders and food handling rather than determining nutrition.
Allergy information is included in the prompt, but model output is not certified
allergen-free. Verify ingredients and cross-contact; use a qualified professional
for complex allergies or medical requirements.

Names/exact coordinates are excluded from the LLM prompt. The API does not
persist profiles and disables application access logs. The city label (if used),
weather and other profile fields go to OpenAI with store=false; if enabled, the
same minimized profile goes to Google Gemini when OpenAI fails; provider logging
and retention policies still apply. Coordinates go to the weather provider.
A shared server API key is suitable for a controlled demo; keep it out of public
browser bundles. Production needs user authentication, per-user quotas, a rate
limiting gateway, secret management and reviewed nutrition rules. Concurrency
control is per process, not a distributed quota. No cross-origin frontend is
configured; add narrowly scoped CORS if building one.

Open-Meteo free hosted API is for non-commercial use; commercial deployments
must use an appropriate subscription/endpoint and weather key. Weather source
attribution is returned in every successful response.

## Verification

```bash
python -m pytest -q
```

Tests use mocked weather/LLM providers, so they do not spend tokens. Live weather,
OpenAI and ngrok checks require your credentials and network access.

## Gemini fallback

Add these values to the backend .env and restart Python:

```env
GEMINI_FALLBACK_ENABLED=true
GEMINI_API_KEY=YOUR_ACTUAL_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_SECONDS=60
```

Create a key at https://aistudio.google.com/apikey. Use a model available to your
Google project that supports generateContent and structured JSON output. The
default is the model shown in Google's current structured-output documentation.
This implementation uses async HTTP REST calls; no extra Gemini SDK is needed.
OpenAI stays primary; Gemini handles rate-limit/quota, timeout, connection,
provider and malformed-output failures. Safety refusals are not rerouted.
Gemini retries transient connection/500/502/503/504 failures once within its total timeout and must return a complete, validated DietPlan. No guessed plan
is returned if both providers fail. Clinical/consent guards still run first.
The API adds llm_provider, llm_model and fallback_used. Existing React UI remains
compatible without modification. Both providers have independent quotas/billing.
The rate-limit screenshot alone cannot distinguish temporary limits from billing
quota exhaustion; check OpenAI API billing if failures persist.
Fallback increases maximum request time; each default model timeout is 60 seconds.
User profile fields may be sent to Google on fallback; ensure users consent to
processing by both AI providers and review their data policies.

## Diagnose Gemini configuration

Run from the backend folder: `python check_gemini.py`.
It reads the same configuration as the API, checks the key against the models
endpoint, confirms the configured model, and makes a small structured-JSON call
(which uses your Gemini quota). It prints no secret or raw provider payload.
If the model is unavailable, it lists accessible Flash model IDs; select a text
model and set GEMINI_MODEL to that exact ID. System environment values override
.env, so an old terminal GEMINI_API_KEY can override the new file value.
The updated backend distinguishes invalid keys, unavailable models, denied
access, malformed requests, quota exhaustion and network failures. The fallback
uses responseMimeType and responseJsonSchema in the generateContent REST body.
Never share .env or keys when reporting the diagnostic output.

Gemini terminal warnings now include HTTP status or connection exception type,
without provider payloads or secrets. Authentication, model and quota errors
are not retried. Both Gemini attempts share GEMINI_TIMEOUT_SECONDS.
