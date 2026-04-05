import React, { useState, useEffect } from 'react';

const ACIDispatchApp = () => {
  const [activeTab, setActiveTab] = useState('weekly');
  const [loading, setLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [dispatchResult, setDispatchResult] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [debugLog, setDebugLog] = useState([]);
  
  const [settings, setSettings] = useState({
    housecallProApiKey: localStorage.getItem('hcp_key') || '',
    claudeApiKey: localStorage.getItem('claude_key') || '',
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
    crew_preferences: 'Ira leads North (Melbourne). Leslie leads South (Palm Bay). Terra floats. Porshua DEDICATED to Beach Island only. Tiara & McKayla always together.',
    vacation_blocks: '',
  });

  const MCP_ENDPOINT = 'https://kpwafdzgvqbtohvbkxbu.supabase.co/functions/v1/mcp-server';

  function getNextWednesday() {
    const today = new Date();
    const day = today.getDay();
    const daysUntilWednesday = (3 - day + 7) % 7 || 7;
    const nextWednesday = new Date(today);
    nextWednesday.setDate(today.getDate() + daysUntilWednesday);
    return nextWednesday.toISOString().split('T')[0];
  }

  const addDebugLog = (message, data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = data ? `[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}` : `[${timestamp}] ${message}`;
    setDebugLog(prev => [...prev, logEntry]);
    console.log(logEntry);
  };

  useEffect(() => {
    // Initialize on mount
  }, []);

  const queryMCPServer = async (tool, params = {}) => {
    try {
      const response = await fetch(MCP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, params })
      });

      if (!response.ok) throw new Error(`MCP Server error: ${response.status}`);
      const data = await response.json();
      return data;
    } catch (err) {
      console.error(`MCP Query failed (${tool}):`, err);
      return { success: false, error: err.message };
    }
  };

  const syncLovableData = async () => {
    setSyncProgress('📱 Syncing comprehensive CleanOps data from Lovable...');
    addDebugLog('Starting Lovable sync');

    try {
      setSyncProgress('👥 Loading employee roster and skills...');
      const employeesResult = await queryMCPServer('list_employees');
      if (!employeesResult.success) throw new Error(`Failed to get employees: ${employeesResult.error}`);

      setSyncProgress('⏰ Fetching team availability for the week...');
      const startDate = weeklySchedule.week_start_date;
      const endDate = new Date(new Date(startDate).getTime() + 6*24*60*60*1000).toISOString().split('T')[0];
      
      const availabilityResult = await queryMCPServer('get_availability', {
        start_date: startDate,
        end_date: endDate,
      });
      if (!availabilityResult.success) throw new Error(`Failed to get availability: ${availabilityResult.error}`);

      setSyncProgress('✓ Lovable synced (simplified for debug)');
      addDebugLog('Lovable sync successful');
      return true;
    } catch (err) {
      setSyncProgress(`⚠️ Lovable sync error: ${err.message}`);
      addDebugLog('Lovable sync error', err.message);
      return false;
    }
  };

  const callHouseCallProProxy = async (endpoint, params = {}) => {
    try {
      const response = await fetch('/api/housecall-pro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint,
          apiKey: settings.housecallProApiKey,
          params
        })
      });

      const responseText = await response.text();
      
      // Try to parse as JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        addDebugLog(`${endpoint} proxy returned non-JSON`, {
          status: response.status,
          responsePreview: responseText.substring(0, 200)
        });
        throw new Error(`${endpoint} proxy returned non-JSON (status ${response.status})`);
      }

      if (!response.ok) {
        addDebugLog(`${endpoint} API error`, data);
        throw new Error(`${endpoint} API error: ${JSON.stringify(data)}`);
      }

      if (data.error) {
        addDebugLog(`${endpoint} error response`, data);
        throw new Error(`${endpoint}: ${data.error}`);
      }

      return data.data;
    } catch (err) {
      throw new Error(`${endpoint} failed: ${err.message}`);
    }
  };

  const syncHouseCallPro = async () => {
    if (!settings.housecallProApiKey.trim()) {
      setError('Please enter HouseCall Pro API key');
      addDebugLog('ERROR: No HouseCall Pro API key provided');
      return false;
    }

    setSyncProgress('🔄 Connecting to HouseCall Pro via secure proxy...');
    addDebugLog('Starting HouseCall Pro sync (via backend proxy)');
    addDebugLog('API Key format', settings.housecallProApiKey.substring(0, 10) + '...');

    try {
      setSyncProgress('📥 Fetching scheduled jobs...');
      addDebugLog('Fetching jobs from HouseCall Pro');
      
      const startDate = new Date(weeklySchedule.week_start_date);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);

      addDebugLog('Date range', {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      });

      const jobsData = await callHouseCallProProxy('jobs', {
        page: 1,
        page_size: 100,
        scheduled_start_min: startDate.toISOString().split('T')[0],
        scheduled_start_max: endDate.toISOString().split('T')[0]
      });
      addDebugLog('Jobs data received', {
        jobCount: jobsData.jobs?.length || 0,
        totalPages: jobsData.total_pages || 0
      });

      setSyncProgress(`✓ Found ${jobsData.jobs?.length || 0} jobs. Fetching crew...`);

      setSyncProgress('👥 Fetching team members...');
      const crewData = await callHouseCallProProxy('employees', {
        page: 1,
        page_size: 100
      });
      addDebugLog('Crew data received', {
        crewCount: crewData.employees?.length || 0
      });

      setSyncProgress(`✓ Found ${crewData.employees?.length || 0} crew.`);

      // Note: HouseCall Pro doesn't have a direct /customers endpoint
      // Customer data comes from the jobs response
      const customersData = { data: [] };

      const transformedJobs = (jobsData.jobs || [])
        .filter(job => job.work_status === 'scheduled' || job.work_status === 'in_progress')
        .map(job => ({
          id: job.id,
          property: job.customer_name || 'Unknown',
          duration_estimate: job.estimate_minutes || 120,
          type: job.location_name?.toLowerCase().includes('vacation') ? 'vr_turnover' : 'residential',
          scheduled_start: job.scheduled_start,
          priority: 'medium',
          notes: job.notes || [],
          status: job.work_status
        }));

      addDebugLog('Jobs filtered by date range', {
        total: jobsData.jobs?.length || 0,
        filtered: transformedJobs.length,
        dateRange: `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`
      });

      const transformedCrew = (crewData.employees || []).map(member => ({
        id: member.id,
        name: `${member.first_name} ${member.last_name}`,
        email: member.email,
        phone: member.mobile_number,
        status: member.status || 'active',
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
      }));

      const newSettings = { ...settings, lastSync: new Date().toISOString() };
      setSettings(newSettings);
      localStorage.setItem('last_sync', newSettings.lastSync);

      setSyncProgress(`✓ HouseCall Pro synced: ${transformedJobs.length} jobs, ${transformedCrew.length} crew`);
      addDebugLog('HouseCall Pro sync successful');
      setError(null); // Clear any previous errors
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`HouseCall Pro sync failed: ${errorMsg}`);
      setSyncProgress('❌ HouseCall Pro sync failed');
      addDebugLog('HouseCall Pro sync error', {
        message: errorMsg,
        fullError: String(err)
      });
      return false;
    }
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
    setSyncProgress('🤖 Claude is analyzing your complete operational picture...');
    setError(null);

    const dispatchPrompt = `You are an expert dispatcher for American Cleaning Innovations (ACI) with deep knowledge of crew dynamics, geographic constraints, and operational rules.

WEEK: ${weeklySchedule.week_start_date} (Wednesday) through ${new Date(new Date(weeklySchedule.week_start_date).getTime() + 6*24*60*60*1000).toISOString().split('T')[0]} (Tuesday)

JOBS TO SCHEDULE (${liveData.weeklyJobs.length} total):
${JSON.stringify(liveData.weeklyJobs.slice(0, 50), null, 2)}

CREW ROSTER:
${JSON.stringify(liveData.availableCrew, null, 2)}

CREW PREFERENCES:
${weeklySchedule.crew_preferences}

VACATION/UNAVAILABLE:
${weeklySchedule.vacation_blocks || 'None'}

TASK: Generate optimal weekly dispatch schedule with simple JSON output showing crew assignments, start/end times, and reasoning.`;

    try {
      setSyncProgress('📤 Sending data to Claude...');
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

      setSyncProgress('🧠 Claude is reasoning about your operation...');
      const data = await response.json();
      const responseText = data.content[0].text;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw_response: responseText };

      setDispatchResult(result);

      setSyncProgress('✓ Optimal schedule generated');
      setStatus('✓ Schedule optimized with complete CleanOps intelligence.');
    } catch (err) {
      setError(`Claude dispatch failed: ${err.message}`);
      setSyncProgress('❌ Schedule generation failed');
      addDebugLog('Claude error', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateClick = async () => {
    setSyncProgress('');
    setError(null);
    setDebugLog([]);
    
    await syncLovableData();
    await syncHouseCallPro();
    
    // Wait a moment for state to update
    setTimeout(() => {
      if (liveData.weeklyJobs.length === 0) {
        setError('No jobs for this week. Sync HouseCall Pro first.');
      } else {
        generateWeeklyDispatch();
      }
    }, 500);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f0f4f8 0%, #d9e8f5 100%)', padding: '2rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', padding: '2rem', marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1f2937', margin: '0 0 0.5rem 0' }}>
            ⚡ ACI Weekly AI Dispatch
          </h1>
          <p style={{ color: '#6b7280', margin: 0 }}>Debug Mode - HouseCall Pro API Testing</p>
        </div>

        {syncProgress && (
          <div style={{ background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', color: '#1e40af' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>🔄 Status:</div>
            <div style={{ fontSize: '1rem', fontFamily: 'monospace' }}>{syncProgress}</div>
          </div>
        )}

        {status && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', color: '#15803d' }}>
            ✓ {status}
          </div>
        )}

        {error && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', color: '#dc2626' }}>
            ❌ {error}
          </div>
        )}

        {debugLog.length > 0 && (
          <div style={{ background: '#f5f5f5', border: '1px solid #d1d5db', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', maxHeight: '400px', overflow: 'auto' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>📋 Debug Log:</div>
            {debugLog.map((log, i) => (
              <div key={i} style={{ fontSize: '0.75rem', fontFamily: 'monospace', marginBottom: '0.5rem', color: '#333', lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {log}
              </div>
            ))}
          </div>
        )}

        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
            {[
              { id: 'weekly', label: '📊 Weekly Dispatch' },
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
                  fontSize: '0.9rem',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: '2rem' }}>
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
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>Crew Preferences & Constraints</label>
                  <textarea
                    value={weeklySchedule.crew_preferences}
                    onChange={(e) => setWeeklySchedule({ ...weeklySchedule, crew_preferences: e.target.value })}
                    style={{ width: '100%', height: '100px', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'sans-serif' }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>Vacation/Unavailable Days</label>
                  <textarea
                    value={weeklySchedule.vacation_blocks}
                    onChange={(e) => setWeeklySchedule({ ...weeklySchedule, vacation_blocks: e.target.value })}
                    style={{ width: '100%', height: '80px', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'sans-serif' }}
                  />
                </div>

                <button
                  onClick={handleGenerateClick}
                  disabled={loading || !settings.housecallProApiKey || !settings.claudeApiKey}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: loading || !settings.housecallProApiKey || !settings.claudeApiKey ? '#d1d5db' : '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '1rem',
                  }}
                >
                  {loading ? '🔄 Syncing & Generating...' : '⚡ Generate Weekly Schedule'}
                </button>

                {dispatchResult && (
                  <div style={{ marginTop: '2rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '4px', padding: '1rem' }}>
                    <h3 style={{ color: '#166534', marginBottom: '1rem' }}>✓ Weekly Schedule Generated</h3>
                    <details style={{ cursor: 'pointer' }}>
                      <summary style={{ fontWeight: '600', color: '#166534' }}>View Full Schedule JSON</summary>
                      <pre style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '4px', overflow: 'auto', maxHeight: '400px', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                        {JSON.stringify(dispatchResult, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            )}

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
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '2rem', color: '#6b7280', fontSize: '0.875rem' }}>
          <p>🚀 ACI Weekly AI Dispatch - Debug Version</p>
        </div>
      </div>
    </div>
  );
};

export default ACIDispatchApp;