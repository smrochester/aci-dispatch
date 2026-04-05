import React, { useState, useEffect, useRef } from 'react';

const ACIDispatchApp = () => {
  const [activeTab, setActiveTab] = useState('weekly');
  const [loading, setLoading] = useState(false);
  const [dispatchResult, setDispatchResult] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [savedSchedules, setSavedSchedules] = useState([]);
  
  const [settings, setSettings] = useState({
    housecallProApiKey: localStorage.getItem('hcp_key') || '',
    claudeApiKey: localStorage.getItem('claude_key') || '',
    historicalCsvUploaded: !!localStorage.getItem('csv_uploaded'),
    lastSync: localStorage.getItem('last_sync'),
  });

  const [liveData, setLiveData] = useState({
    weeklyJobs: [],
    availableCrew: [],
    properties: [],
    historicalContext: null,
    lastUpdated: null,
  });

  const [weeklySchedule, setWeeklySchedule] = useState({
    week_start_date: getNextWednesday(),
    crew_preferences: 'Standard rotation',
    vacation_blocks: '',
  });

  const csvFileRef = useRef(null);

  function getNextWednesday() {
    const today = new Date();
    const day = today.getDay();
    const daysUntilWednesday = (3 - day + 7) % 7 || 7;
    const nextWednesday = new Date(today);
    nextWednesday.setDate(today.getDate() + daysUntilWednesday);
    return nextWednesday.toISOString().split('T')[0];
  }

  useEffect(() => {
    loadPastSchedules();
  }, []);

  const savePastSchedule = async (weekStart, scheduleData) => {
    const allSchedules = JSON.parse(localStorage.getItem('past_schedules') || '{}');
    allSchedules[weekStart] = scheduleData;
    localStorage.setItem('past_schedules', JSON.stringify(allSchedules));
    setStatus(`✓ Schedule saved`);
  };

  const loadPastSchedules = () => {
    const schedules = JSON.parse(localStorage.getItem('past_schedules') || '{}');
    setSavedSchedules(Object.keys(schedules).sort().reverse());
  };

  const syncHouseCallPro = async () => {
    if (!settings.housecallProApiKey.trim()) {
      setError('Please enter HouseCall Pro API key');
      return;
    }

    setLoading(true);
    setStatus('Syncing with HouseCall Pro...');
    setError(null);

    try {
      const startDate = new Date(weeklySchedule.week_start_date);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);

      const jobsResponse = await fetch(
        `https://api.housecallpro.com/v2/jobs?status=scheduled,in_progress&limit=200`,
        {
          headers: {
            'Authorization': `Bearer ${settings.housecallProApiKey}`,
            'Content-Type': 'application/json',
          }
        }
      );

      if (!jobsResponse.ok) {
        throw new Error(`HouseCall Pro API error: ${jobsResponse.status}`);
      }

      const jobsData = await jobsResponse.json();

      const crewResponse = await fetch(
        `https://api.housecallpro.com/v2/team_members?limit=50`,
        {
          headers: {
            'Authorization': `Bearer ${settings.housecallProApiKey}`,
            'Content-Type': 'application/json',
          }
        }
      );

      const crewData = await crewResponse.json();

      const customersResponse = await fetch(
        `https://api.housecallpro.com/v2/customers?limit=500`,
        {
          headers: {
            'Authorization': `Bearer ${settings.housecallProApiKey}`,
            'Content-Type': 'application/json',
          }
        }
      );

      const customersData = await customersResponse.json();

      const transformedJobs = (jobsData.data || [])
        .filter(job => {
          const jobDate = new Date(job.scheduled_start_time);
          return jobDate >= startDate && jobDate <= endDate;
        })
        .map(job => ({
          id: job.id,
          property: job.customer?.business_name || job.customer?.name || 'Unknown',
          duration_estimate: job.estimate_minutes || 120,
          type: job.location?.name?.toLowerCase().includes('vacation') ? 'vr_turnover' : 'residential',
        }));

      const transformedCrew = (crewData.data || []).map(member => ({
        id: member.id,
        name: member.name,
      }));

      const transformedCustomers = (customersData.data || []).map(customer => ({
        id: customer.id,
        name: customer.business_name || customer.name,
      }));

      setLiveData(prev => ({
        ...prev,
        weeklyJobs: transformedJobs,
        availableCrew: transformedCrew,
        properties: transformedCustomers,
        lastUpdated: new Date().toLocaleTimeString(),
      }));

      const newSettings = { ...settings, lastSync: new Date().toISOString() };
      setSettings(newSettings);
      localStorage.setItem('last_sync', newSettings.lastSync);

      setStatus(`✓ Synced: ${transformedJobs.length} jobs, ${transformedCrew.length} crew`);
    } catch (err) {
      setError(`HouseCall Pro sync failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCsvUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    setStatus('Processing historical CSV...');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const csv = e.target.result;
        const lines = csv.split('\n').slice(1);

        const historicalJobs = lines
          .filter(line => line.trim())
          .map(line => {
            const [date, property_id, cleaner_id, duration] = line.split(',');
            return {
              date: date.trim(),
              property_id: property_id.trim(),
              cleaner_id: cleaner_id.trim(),
              actual_duration: parseInt(duration),
            };
          });

        const crewSpeedMultipliers = {};

        historicalJobs.forEach(job => {
          if (!crewSpeedMultipliers[job.cleaner_id]) {
            crewSpeedMultipliers[job.cleaner_id] = { total: 0, count: 0 };
          }
          crewSpeedMultipliers[job.cleaner_id].total += job.actual_duration;
          crewSpeedMultipliers[job.cleaner_id].count += 1;
        });

        const historicalContext = {
          total_jobs: historicalJobs.length,
          crew_speed_multipliers: crewSpeedMultipliers,
          processed_at: new Date().toLocaleTimeString(),
        };

        setLiveData(prev => ({
          ...prev,
          historicalContext,
        }));

        localStorage.setItem('csv_uploaded', 'true');
        const newSettings = { ...settings, historicalCsvUploaded: true };
        setSettings(newSettings);

        setStatus(`✓ Processed ${historicalJobs.length} historical jobs.`);
      } catch (err) {
        setError(`CSV processing failed: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    reader.readAsText(file);
  };

  const generateWeeklyDispatch = async () => {
    if (!settings.claudeApiKey.trim()) {
      setError('Please enter Claude API key');
      return;
    }

    if (liveData.weeklyJobs.length === 0) {
      setError('No jobs for this week. Sync HouseCall Pro first.');
      return;
    }

    setLoading(true);
    setStatus('Claude is optimizing your weekly schedule...');
    setError(null);

    const dispatchPrompt = `You are an expert dispatcher for American Cleaning Innovations (ACI).

WEEK: ${weeklySchedule.week_start_date} (Wednesday) through ${new Date(new Date(weeklySchedule.week_start_date).getTime() + 6*24*60*60*1000).toISOString().split('T')[0]} (Tuesday)

JOBS (${liveData.weeklyJobs.length} total):
${JSON.stringify(liveData.weeklyJobs, null, 2)}

CREW:
${JSON.stringify(liveData.availableCrew, null, 2)}

CREW PREFERENCES:
${weeklySchedule.crew_preferences}

TASK: Generate weekly dispatch schedule with crew assignments, times, and confidence levels.

Output JSON:
{
  "weekly_schedule": [
    {
      "date": "2024-XX-XX",
      "jobs": [
        {
          "job_id": "...",
          "assigned_crew": "...",
          "start_time": "HH:MM",
          "end_time": "HH:MM",
          "confidence": 90
        }
      ]
    }
  ],
  "crew_utilization": {},
  "summary": "..."
}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.claudeApiKey,
        },
        body: JSON.stringify({
          model: 'claude-opus-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: dispatchPrompt }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Claude API error');
      }

      const data = await response.json();
      const responseText = data.content[0].text;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw_response: responseText };

      setDispatchResult(result);
      await savePastSchedule(weeklySchedule.week_start_date, result);
      await loadPastSchedules();

      setStatus('✓ Weekly schedule optimized and saved.');
    } catch (err) {
      setError(`Claude dispatch failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f0f4f8 0%, #d9e8f5 100%)', padding: '2rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', padding: '2rem', marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1f2937', margin: '0 0 0.5rem 0' }}>
            ⚡ ACI Weekly AI Dispatch
          </h1>
          <p style={{ color: '#6b7280', margin: 0 }}>Plan your entire week on Sunday. Optimize automatically.</p>
        </div>

        {/* Status Messages */}
        {status && (
          <div style={{ background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', color: '#1e40af' }}>
            {status}
          </div>
        )}

        {error && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', color: '#dc2626' }}>
            ❌ {error}
          </div>
        )}

        {/* Main Container */}
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
            {[
              { id: 'weekly', label: '📊 Weekly Dispatch' },
              { id: 'history', label: '📋 Past Schedules' },
              { id: 'settings', label: '⚙️ Setup' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: '1rem',
                  border: 'none',
                  background: activeTab === tab.id ? '#2563eb' : '#f9fafb',
                  color: activeTab === tab.id ? 'white' : '#4b5563',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div style={{ padding: '2rem' }}>
            {/* Weekly Dispatch Tab */}
            {activeTab === 'weekly' && (
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>Generate Weekly Schedule</h2>
                
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>Week Start (Wednesday)</label>
                  <input
                    type="date"
                    value={weeklySchedule.week_start_date}
                    onChange={(e) => setWeeklySchedule({ ...weeklySchedule, week_start_date: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>Crew Preferences</label>
                  <textarea
                    value={weeklySchedule.crew_preferences}
                    onChange={(e) => setWeeklySchedule({ ...weeklySchedule, crew_preferences: e.target.value })}
                    style={{ width: '100%', height: '80px', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'sans-serif' }}
                  />
                </div>

                <button
                  onClick={() => {
                    syncHouseCallPro().then(() => generateWeeklyDispatch());
                  }}
                  disabled={loading || !settings.housecallProApiKey || !settings.claudeApiKey}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: loading || !settings.housecallProApiKey || !settings.claudeApiKey ? '#d1d5db' : '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: '600',
                    cursor: loading || !settings.housecallProApiKey || !settings.claudeApiKey ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? 'Generating...' : 'Generate Schedule'}
                </button>

                {dispatchResult && (
                  <div style={{ marginTop: '2rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '4px', padding: '1rem' }}>
                    <h3 style={{ color: '#166534', marginBottom: '1rem' }}>✓ Schedule Generated</h3>
                    <pre style={{ background: 'white', padding: '1rem', borderRadius: '4px', overflow: 'auto', maxHeight: '300px', fontSize: '0.875rem' }}>
                      {JSON.stringify(dispatchResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Past Schedules Tab */}
            {activeTab === 'history' && (
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>Past Schedules</h2>
                {savedSchedules.length > 0 ? (
                  <div>
                    {savedSchedules.map(week => (
                      <button
                        key={week}
                        onClick={() => {
                          const allSchedules = JSON.parse(localStorage.getItem('past_schedules') || '{}');
                          setDispatchResult(allSchedules[week]);
                          setWeeklySchedule({ ...weeklySchedule, week_start_date: week });
                          setActiveTab('weekly');
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '1rem',
                          marginBottom: '0.5rem',
                          background: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: '600' }}>Week of {week}</div>
                        <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Wed-Tue payroll week</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#6b7280' }}>No schedules saved yet.</p>
                )}
              </div>
            )}

            {/* Settings Tab */}
            {activeTab === 'settings' && (
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>Setup & Configuration</h2>

                <div style={{ marginBottom: '1.5rem', border: '1px solid #d1d5db', borderRadius: '4px', padding: '1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>HouseCall Pro API Key</label>
                  <input
                    type="password"
                    placeholder="hcp_..."
                    value={settings.housecallProApiKey}
                    onChange={(e) => {
                      setSettings({ ...settings, housecallProApiKey: e.target.value });
                      localStorage.setItem('hcp_key', e.target.value);
                    }}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                  />
                  <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>Get from HouseCall Pro Settings → Integrations → API</p>
                </div>

                <div style={{ marginBottom: '1.5rem', border: '1px solid #93c5fd', background: '#eff6ff', borderRadius: '4px', padding: '1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>Claude API Key</label>
                  <input
                    type="password"
                    placeholder="sk-ant-..."
                    value={settings.claudeApiKey}
                    onChange={(e) => {
                      setSettings({ ...settings, claudeApiKey: e.target.value });
                      localStorage.setItem('claude_key', e.target.value);
                    }}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
                  />
                  <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>Get from <a href="https://console.anthropic.com/api/keys" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>Anthropic Console</a></p>
                </div>

                <div style={{ marginBottom: '1.5rem', border: '1px solid #d1d5db', borderRadius: '4px', padding: '1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>Historical Job Data (CSV)</label>
                  <input
                    type="file"
                    ref={csvFileRef}
                    onChange={handleCsvUpload}
                    accept=".csv"
                    style={{ width: '100%' }}
                  />
                  {settings.historicalCsvUploaded && (
                    <p style={{ fontSize: '0.875rem', color: '#15803d', marginTop: '0.5rem' }}>✓ Historical data loaded</p>
                  )}
                </div>

                {settings.lastSync && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '4px', padding: '1rem' }}>
                    <p style={{ color: '#166534', margin: 0 }}>✓ Last synced: {new Date(settings.lastSync).toLocaleString()}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: '2rem', color: '#6b7280', fontSize: '0.875rem' }}>
          <p>🚀 ACI Weekly AI Dispatch - Plan, optimize, execute.</p>
        </div>
      </div>
    </div>
  );
};

export default ACIDispatchApp;
