/* Model cards: what each model does, what it was checked against, and where it should not be trusted.
   Written from the code in js/models/*.js — change the card when you change the model. Skill: skills/backtest/SKILL.md */
(function (root) {
  const AA = root.AA;
  const C = {};
  // status: 'validated' (systematic back-test) · 'tested' (automated checks) · 'calibrated' (fitted to a few documented events) · 'indicative' (order of magnitude only)
  C.CARDS = [
    {
      id: 'EQ', title: 'Earthquake impact', status: 'indicative',
      purpose: 'People affected, displaced, injured and killed around an earthquake, by area, with a 10–90 % range.',
      method: [
        'Shaking (Modified Mercalli intensity) = a + 1.5·M − 4·log10(distance), with distance measured from the rupture (length from Wells & Coppersmith 1994) and the depth; a = 2.5, or fitted to the USGS observed intensity for live events.',
        'Affected and displaced: lognormal damage curves (affected from intensity 6.5, displaced from about 8); weaker housing (country vulnerability from World Bank indicators) shifts them down.',
        'Deaths: the USGS PAGER empirical model, share killed = Φ(ln(intensity/θ)/β), with a separate θ and β for each of 252 countries and territories (Jaiswal & Wald 2010).',
        '400 simulations vary magnitude (±0.2), shaking (±0.8 intensity units), population (±20 %) and the country death rate (a log-normal spread of 0.7, or 1.0 where the country uses a group curve). These spreads are stated assumptions, not fitted to the back-test; P10, P50 and P90 are read from them.',
        'Live events: the USGS PAGER loss estimate replaces the model’s deaths when published; GDACS-reported counts are a floor.',
      ],
      inputs: 'Magnitude, depth and location (USGS / GDACS or user); towns and populations (OpenStreetMap, WorldPop 2020 in plans); World Bank country indicators.',
      evidence: 'Back-test against the NOAA NCEI catalogue (38 shaking-dominated earthquakes since 2001, run on this page). Model 3.0: reported toll inside the range 8–10 times in 39 (about 20–26 %), typical error ×48–60. Model 3.1 (first live run, OpenStreetMap populations): 23 of 38 inside (61 %, the aim is 80 %), typical error ×12.7, within ×3 for 24 %, forecasts about 4× too low on average; worst for Indonesia, Afghanistan and Japan. The wide range does most of the work: treat deaths as an order of magnitude. Live events use the USGS PAGER estimate where published.',
      limits: ['No tsunami, landslide or liquefaction: those deaths are not modelled (such events are shown but not scored).', 'Deep earthquakes (over 70 km) are not scored and not reliable.', 'Uses today’s population for past events.', 'Building quality only through a national vulnerability index, so places with strict building codes may be over-forecast and very weak housing under-forecast (see the back-test table).', 'Aftershocks only when a planner adds one.'],
    },
    {
      id: 'TC', title: 'Tropical cyclone impact', status: 'indicative',
      purpose: 'People affected and displaced by wind around a cyclone track point.',
      method: ['Wind decays beyond 30 km as V·(30/r)^0.7.', 'Lognormal damage curves at 120 (affected), 160 (displaced) and 210 km/h (severe damage); deaths 0.2 % of the severely damaged.', 'GDACS lifetime-maximum wind is capped to the current episode’s alert band.'],
      inputs: 'Maximum sustained wind and position (GDACS / user); populations as above.',
      evidence: 'Not yet back-tested. Wind-damage shapes follow published fragility work; death rates are a planning assumption.',
      limits: ['No storm surge or rainfall flooding, which cause most cyclone deaths (Nargis 2008, Haiyan 2013): deaths can be badly under-forecast on low coasts.', 'One track point, not the full track.'],
    },
    {
      id: 'FL', title: 'Flood impact', status: 'calibrated',
      purpose: 'People affected, displaced, injured and killed by river floods and flash floods.',
      method: ['Flood intensity falls off with distance from the flood centre; for live floods, GloFAS river flow at each area against its yearly median replaces the distance rule, and the GDACS flood outline decides where towns are searched.', 'Flash floods (steep terrain, glacial-lake outbursts, cloudbursts, dam failures) and river floods have separate death and displacement rates.', 'Agency-reported deaths, missing and displaced are a floor.'],
      inputs: 'GDACS event and outline, GloFAS discharge (Open-Meteo), elevation, populations.',
      evidence: 'Calibrated on the Nepal 2026 flash flood (IFRC: about 1 death per 100 people affected) and Pakistan 2022 river floods plus the 1980–2009 world average (Doocy et al. 2013: about 1 per 10,000).',
      limits: ['Not systematically back-tested yet.', 'Flood depth and flood defences are not modelled.', 'The flash/river choice changes deaths a hundredfold; check the flood type shown in the plan.'],
    },
    {
      id: 'VO', title: 'Volcano, wildfire and drought impact', status: 'indicative',
      purpose: 'A rough count of people affected near an eruption, a fire or across a drought area.',
      method: ['An intensity score 0–1 from the agency alert level, decaying with distance (fire and drought use their reported area).', 'Affected from score 0.35; displaced 100 % of affected for volcanoes, 50 % for fires, none for droughts; deaths 1 in 10,000 affected (none for droughts).'],
      inputs: 'GDACS / NASA EONET events; populations.',
      evidence: 'None beyond plausibility checks.',
      limits: ['Order of magnitude only. Use for preparing stock, not for casualty figures.'],
    },
    {
      id: 'PLAN', title: 'Relief plan (allocation and routing)', status: 'tested',
      purpose: 'Which store sends what to which area, by which road, each 6 hours, by need and at the lowest cost.',
      method: ['Need score: severity 35 %, people 20 %, vulnerability 20 %, access 15 %, already received −10 % (editable).', 'Demand from Sphere standards (water 15 L, food 0.6 kg per displaced person per day, a tent per 5 displaced, medical modules, staff).', 'Mixed-integer allocation with minimum shares of water and medical, a need-weighted fairness term and road congestion; Clarke–Wright multi-stop runs; OSRM roads adjusted for modelled damage and closures; a survival-weighted model sends the injured to hospitals with free beds.', 'Compared every time with the nearest-store rule (cost-saving report).'],
      inputs: 'The forecast above; stores and hospitals (OpenStreetMap or your inventory); OSRM road times.',
      evidence: 'Automated checks: stock, fleet and fairness constraints hold; optimised plan never worse per tonne than nearest-store when stock is plentiful; high-need areas get more water when stock is scarce.',
      limits: ['Stock and vehicles are assumed by facility type until real inventory is connected.', 'Road damage is modelled, not observed, unless closures or field reports are entered.'],
    },
  ];
  C.STATUS = { validated: 'Back-tested', tested: 'Checked by automated tests', calibrated: 'Calibrated on a few events', indicative: 'Indicative only' };
  AA.cards = C;
})(typeof window !== 'undefined' ? window : globalThis);
