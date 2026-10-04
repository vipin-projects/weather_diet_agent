"""Run from backend folder: python check_gemini.py. Never prints the API key."""
import asyncio
import json
import re
from pathlib import Path

import httpx
from diet_agent_api import Settings, gemini_provider_error


async def main():
    settings = Settings()
    key = settings.gemini_api_key.get_secret_value().strip()
    print(f"Configuration file: {Path('.env').resolve()}")
    print("System environment values override .env values if both are set.")
    print(f"Configured model: {settings.gemini_model}")
    if not key or key.startswith(('YOUR_', 'REPLACE_')):
        print('GEMINI_API_KEY is missing or still a placeholder. Set it in backend .env.')
        return 1
    async with httpx.AsyncClient(timeout=30) as http:
        try:
            names = []
            token = None
            for _ in range(10):
                response = await http.get('https://generativelanguage.googleapis.com/v1beta/models',
                    headers={'x-goog-api-key': key}, params={'pageSize': 100, **({'pageToken': token} if token else {})})
                if response.is_error:
                    error = gemini_provider_error(response)
                    print(f'HTTP {response.status_code}: {error.code}. {error.message}')
                    return 1
                data = response.json()
                names.extend(m['name'].removeprefix('models/') for m in data.get('models', [])
                    if 'generateContent' in m.get('supportedGenerationMethods', []) and re.fullmatch(r'models/[A-Za-z0-9._-]+',m.get('name','')))
                token = data.get('nextPageToken')
                if not token: break
            print('Key accepted for listing models.')
            if settings.gemini_model not in names:
                print('Configured model is not listed for generateContent. Choose an available text model:')
                for name in names:
                    if 'gemini' in name and 'flash' in name: print('  ' + name)
                return 1
            response = await http.post(f'https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent',
                headers={'x-goog-api-key': key}, json={
                    'contents':[{'parts':[{'text':'Return JSON with ok=true.'}]}],
                    'generationConfig':{'maxOutputTokens':512,'responseMimeType':'application/json',
                        'responseJsonSchema':{'type':'object','properties':{'ok':{'type':'boolean'}},'required':['ok']}}},timeout=60)
            if response.is_error:
                error=gemini_provider_error(response)
                print(f'HTTP {response.status_code}: {error.code}. {error.message}')
                return 1
            candidate=response.json().get('candidates',[{}])[0]
            text=''.join(p.get('text','') for p in candidate.get('content',{}).get('parts',[]) if not p.get('thought'))
            if candidate.get('finishReason')=='STOP' and json.loads(text).get('ok') is True:
                print('PASS: key, selected model and structured JSON generation work.')
                return 0
            print('Key/model accepted, but test generation did not complete. Check output limits/model settings.')
            return 1
        except httpx.TimeoutException:
            print('Provider timed out. Check network connectivity and try again.');return 1
        except httpx.RequestError:
            print('Cannot reach Gemini. Check network/proxy configuration.');return 1
        except (ValueError, KeyError, TypeError, IndexError):
            print('Provider returned unexpected data. Check model availability/settings.');return 1


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
