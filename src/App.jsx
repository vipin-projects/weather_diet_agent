import React, { useEffect, useRef, useState } from 'react';

const initial = { name: '', age: '', sex: 'prefer_not_to_say', locationMode: 'city', city: '', country: 'IN', latitude: '', longitude: '', dietary_preference: 'vegetarian', activity_level: 'moderate', goal: 'balanced_eating', allergies: '', medical_conditions: '', pregnant_or_breastfeeding: false, consent_to_process: false };
const splitList = value => value.split(',').map(s => s.trim()).filter(Boolean);
const titles = { UNAUTHORIZED: 'Connection is not authorized. Check the API_KEY in the frontend server configuration.', AMBIGUOUS_LOCATION: 'Several places match that city. Choose coordinates and enter your exact location.', LOCATION_NOT_FOUND: 'We could not find that city. Try coordinates instead.', SERVER_BUSY: 'The planner is busy. Please try again shortly.', LLM_RATE_LIMITED: 'The model is temporarily busy. Please try again later.' };

function TextList({ title, items }) {
  if (!items?.length) return null;
  return <section className="detail"><h3>{title}</h3><ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul></section>;
}

export default function App() {
  const [form, setForm] = useState(initial);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsMessage, setGpsMessage] = useState('');
  const controller = useRef(null);
  const output = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (result || error) output.current?.focus(); }, [result, error]);
  const change = event => {
    const { name, value, type, checked } = event.target;
    setForm(old => ({ ...old, [name]: type === 'checkbox' ? checked : value }));
  };

  function locate() {
    setGpsMessage('');
    if (!navigator.geolocation) { setGpsMessage('Your browser does not support location. Enter coordinates manually.'); return; }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current) return;
      setForm(old => ({ ...old, locationMode: 'coordinates', latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) }));
      setGpsBusy(false); setGpsMessage('Location captured. Check the coordinates before submitting.');
    }, () => {
      if (!mounted.current) return;
      setGpsBusy(false); setGpsMessage('Location was unavailable or permission was denied. Enter your city or coordinates manually.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError(''); setResult(null);
    const allergies = splitList(form.allergies), conditions = splitList(form.medical_conditions);
    if ([allergies, conditions].some(list => list.length > 20 || list.some(item => item.length > 100))) {
      setError('Use at most 20 entries for allergies or conditions, with at most 100 characters per entry.'); return;
    }
    if (form.locationMode === 'coordinates' && (!form.latitude.trim() || !form.longitude.trim())) {
      setError('Enter both latitude and longitude.'); return;
    }
    const location = form.locationMode === 'city'
      ? { city: form.city.trim(), ...(form.country.trim() ? { country_code: form.country.trim().toUpperCase() } : {}) }
      : { latitude: Number(form.latitude), longitude: Number(form.longitude) };
    const payload = { name: form.name.trim(), age: Number(form.age), sex: form.sex, location, dietary_preference: form.dietary_preference, activity_level: form.activity_level, goal: form.goal, allergies, medical_conditions: conditions, pregnant_or_breastfeeding: form.pregnant_or_breastfeeding, consent_to_process: form.consent_to_process };
    setBusy(true);
    const current = new AbortController(); controller.current = current;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; current.abort(); }, 210000);
    try {
      const response = await fetch('/api/v1/diet-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: current.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = data?.error;
        let message = titles[detail?.code] || detail?.message || `The request failed (${response.status}). Check that the backend is running.`;
        if (detail?.details?.length) message += ' Check: ' + detail.details.map(d => d.field.replace(/^body\./, '')).join(', ') + '.';
        throw new Error(message);
      }
      if (!data || !['success', 'clinician_review_required'].includes(data.status) || (data.status === 'success' && !Array.isArray(data.plan?.meals))) throw new Error('The server returned an incomplete response. Please try again.');
      setResult(data);
    } catch (err) {
      if (mounted.current) setError(err.name === 'AbortError' ? (timedOut ? 'The request timed out. Please try again.' : 'Request cancelled.') : err.message === 'Failed to fetch' ? 'Cannot connect to the server. Check your connection and backend.' : err.message);
    } finally {
      clearTimeout(timer);
      if (mounted.current) setBusy(false);
      controller.current = null;
    }
  }

  return <main className="shell">
    <header><span className="eyebrow">EVERYDAY WELLNESS</span><h1>A meal plan for your day.</h1><p>Tell us a little about yourself. We’ll use your preferences and local weather to suggest balanced meals.</p></header>
    <div className="layout">
      <form className="panel" onSubmit={submit}>
        <div className="panel-heading"><span className="step">01</span><div><h2>Your details</h2><p>Required fields are marked *</p></div></div>
        <fieldset disabled={busy}><legend className="sr-only">Profile and food preferences</legend>
          <label>Full name *<input name="name" value={form.name} onChange={change} required maxLength={100} pattern=".*\S.*" autoComplete="name" placeholder="Your name" /></label>
          <div className="row"><label>Age *<input name="age" type="number" min="1" max="120" step="1" required value={form.age} onChange={change} placeholder="Years" /></label><label>Sex *<select name="sex" value={form.sex} onChange={change}><option value="prefer_not_to_say">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="intersex">Intersex</option></select></label></div>
          <hr /><h3>Your location</h3><p className="hint">Used to retrieve current weather. Device location is optional.</p>
          <div className="location-switch" role="group" aria-label="Location input method"><button type="button" aria-pressed={form.locationMode === 'city'} onClick={() => setForm(old => ({ ...old, locationMode: 'city' }))}>City</button><button type="button" aria-pressed={form.locationMode === 'coordinates'} onClick={() => setForm(old => ({ ...old, locationMode: 'coordinates' }))}>Coordinates</button></div>
          {form.locationMode === 'city' ? <div className="row"><label>City *<input name="city" required minLength={2} maxLength={100} value={form.city} onChange={change} placeholder="Pune" /></label><label>Country code<input name="country" maxLength={2} pattern="[a-zA-Z]{2}" value={form.country} onChange={change} placeholder="IN" /><span className="hint">Two letters, e.g. IN or US</span></label></div> : <div className="row"><label>Latitude *<input name="latitude" type="number" step="any" min="-90" max="90" required value={form.latitude} onChange={change} placeholder="18.559" /></label><label>Longitude *<input name="longitude" type="number" step="any" min="-180" max="180" required value={form.longitude} onChange={change} placeholder="73.786" /></label></div>}
          <button type="button" className="gps" onClick={locate} disabled={gpsBusy}>{gpsBusy ? 'Getting location…' : 'Use my device location'}</button><p className="hint" role="status">{gpsMessage}</p>
          <hr /><h3>Food & lifestyle</h3>
          <div className="row"><label>Food preference<select name="dietary_preference" value={form.dietary_preference} onChange={change}><option value="vegetarian">Vegetarian</option><option value="vegan">Vegan</option><option value="omnivore">Omnivore</option><option value="pescatarian">Pescatarian</option></select></label><label>Activity level<select name="activity_level" value={form.activity_level} onChange={change}><option value="sedentary">Sedentary</option><option value="moderate">Moderate</option><option value="active">Active</option></select></label></div>
          <label>Your goal<select name="goal" value={form.goal} onChange={change}><option value="balanced_eating">Balanced eating</option><option value="weight_management">Weight management</option><option value="muscle_support">Muscle support</option></select></label>
          <label>Food allergies<input name="allergies" value={form.allergies} onChange={change} maxLength={2020} placeholder="e.g. peanuts, milk" /><span className="hint">Separate entries with commas. Leave blank if none.</span></label>
          <label>Medical conditions<input name="medical_conditions" value={form.medical_conditions} onChange={change} maxLength={2020} placeholder="e.g. diabetes, kidney disease" /></label>
          <label className="check"><input name="pregnant_or_breastfeeding" type="checkbox" checked={form.pregnant_or_breastfeeding} onChange={change} /><span>Pregnant or breastfeeding</span></label>
          <p className="hint">Under 18, medical conditions, or pregnancy/breastfeeding require professional dietary guidance.</p>
          <label className="check consent"><input name="consent_to_process" type="checkbox" checked={form.consent_to_process} onChange={change} required /><span>I agree to send my location to the weather provider and my profile details to the AI provider to generate suggestions. *</span></label>
          <button className="primary" type="submit">{busy ? 'Preparing your plan…' : 'Generate my diet plan'}<span aria-hidden="true">↗</span></button>
        </fieldset>
        {busy && <button className="cancel" type="button" onClick={() => controller.current?.abort()}>Cancel request</button>}
      </form>
      <section className="results" aria-busy={busy}>
        <div ref={output} tabIndex={-1} className="output" aria-live="polite">
          {error && <div className="alert" role="alert"><h2>We couldn’t prepare your plan</h2><p>{error}</p></div>}
          {busy && <div className="panel empty"><span className="loader" aria-hidden="true" /><h2>Planning your meals</h2><p>Checking your location, weather and food preferences. This can take a minute or two.</p></div>}
          {!busy && !result && !error && <div className="panel empty"><span className="leaf" aria-hidden="true">✦</span><span className="eyebrow">MADE FOR YOUR DAY</span><h2>Good food starts with a little context.</h2><p>Your meal suggestions, weather summary and hydration guidance will appear here.</p><div className="tags"><span>Local weather</span><span>Food preferences</span><span>Balanced meals</span></div></div>}
          {result?.status === 'clinician_review_required' && <div className="panel review"><span className="eyebrow">PROFESSIONAL GUIDANCE</span><h2>A reviewed plan is the right next step.</h2><p>{result.name}, please consult a qualified clinician or registered dietitian.</p><TextList title="Why a review is needed" items={result.review_reasons} /></div>}
          {result?.status === 'success' && <><div className="panel result-head"><span className="eyebrow">YOUR ONE-DAY PLAN</span><h2>{result.name}, here’s a balanced start.</h2><p>{result.plan.summary}</p>{result.weather && <div className="weather"><div><strong>{Math.round(result.weather.temperature_c)}°C</strong><span>{result.weather.condition}</span></div><div><b>{result.location?.label}</b><span>Feels like {Math.round(result.weather.feels_like_c)}°C · Humidity {result.weather.relative_humidity_percent}%</span><span>Observed {result.weather.observed_at.replace('T', ' ')} ({result.location?.timezone})</span></div></div>}</div>
            <div className="meals">{result.plan.meals.map((meal, i) => <article className="panel meal" key={i}><span className="meal-no">{String(i + 1).padStart(2, '0')}</span><h3>{meal.meal}</h3><ul>{meal.foods.map((food, j) => <li key={j}>{food}</li>)}</ul><p><b>Portions:</b> {meal.portions}</p><p className="hint">{meal.reason}</p></article>)}</div>
            <div className="panel"><h3>Hydration</h3><p>{result.plan.hydration_guidance}</p><TextList title="Weather adjustments" items={result.plan.weather_adjustments} /><TextList title="Allergy precautions" items={result.plan.allergy_precautions} /><TextList title="Assumptions" items={result.plan.assumptions} /></div>
            <p className="attribution">Weather by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · Generated {new Date(result.generated_at).toLocaleString()}</p>
          </>}
          {result && <p className="notice">{result.notice}</p>}
        </div>
      </section>
    </div>
    <footer>General wellness suggestions. Verify ingredients and allergens before eating.</footer>
  </main>;
}
