import React, { useState, useEffect, useRef } from 'react';

const ACIDispatchApp = () => {
  const [activeTab, setActiveTab] = useState('weekly');
  const [loading, setLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
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
    teamAvailability: [],
    jobInteractions: [],
    teamPerformance: [],
    properties: [],
    historicalContext: null,
    lastUpdated: null,
  });

  const [weeklySchedule, setWeeklySchedule] = useState({
    week_start_date: getNextWednesday(),
    crew_preferences: 'Ira leads North. Leslie leads South. Porshua dedicated Beach Island. Tiara & McKayla always together.',
    vacation_blocks: '',
  });

  const csvFileRef = useRef(null);

  // MCP Server endpoint (Lovable Supabase)
  const MCP_ENDPOINT = 'https://kpwafdzgvqbtohvbkxbu.supabase.co/functions/v1/mcp-server';

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

  // Query MCP Server via Lovable's Supabase edge function
  const queryMCPServer = async (query, args = {}) => {
    try {
      const response = await fetch(MCP_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query,
          arguments: args,
        })
      });

      if (!response.ok) {
        throw new Error(`MCP Server error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      console.error(`MCP Query failed (${query}):`, err);
      return { success: false, error: err.message };
    }
  };

  const syncLovableData = async () => {
    setSyncProgress('📱 Fetching team availability from Lovable via MCP server...');

    try {
      // Get team members
      setSyncProgress('👥 Querying team members...');
      const teamResult = await queryMCPServer('get_team_members');
      
      if (!teamResult.success) {
        throw new Error(`Failed to get team members: ${teamResult.error}`);
      }

      // Get team availability
      setSyncProgress('⏰ Fetching current availability...');
      const availabilityResult = await queryMCPServer('get_team_availability');
      
      if (!availabilityResult.success) {
        throw new Error(`Failed to get availability: ${availabilityResult.error}`);
      }

      // Get job interactions
      setSyncProgress('📊 Querying job interactions and success rates...');
      const interactionsResult = await queryMCPServer('get_job_interactions');
      
      if (!interactionsResult.success) {
        throw new Error(`Failed to get interactions: ${interactionsResult.error}`);
      }

      // Get performance data for all team members
      setSyncProgress('🏆 Fetching performance metrics...');
      const teamData = teamResult.data?.team_members || [];
      const performanceData = [];
      
      for (const member of teamData) {
        const perfResult = await queryMCPServer('get_crew_performance', { crew_id: member.id });
        if (perfResult.success && perfResult.data?.performance) {
          performanceData.push({
            crew_id: member.id,
            crew_name: member.name,
            performance: perfResult.data.performance,
          });
        }
      }

      // Update live data with all Lovable information
      setLiveData(prev => ({
        ...prev,
        teamAvailability: availabilityResult.data?.availability || [],
        jobInteractions: interactionsResult.data?.interactions || [],
        teamPerformance: performanceData,
        lastUpdated: new Date().toLocaleTimeString(),
      }));

      setSyncProgress(`✓ Lovable data synced: ${teamData.length} team members, ${(interactionsResult.data?.interactions || []).length} interactions`);
      return true;
    } catch (err) {
      setSyncProgress(`⚠️ Lovable sync error: ${err.message}`);
      console.error('Lovable sync error:', err);
      return false;
    }
  };

  const syncHouseCallPro = async () => {
    if (!settings.housecallProApiKey.trim()) {
      setError('Please enter HouseCall Pro API key');
      return false;
    }

    setSyncProgress('🔄 Connecting to HouseCall Pro...');

    try {
      setSyncProgress('📥 Fetching scheduled jobs...');
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
      setSyncProgress(`✓ Found ${jobsData.data?.length || 0} jobs. Fetching crew...`);

      setSyncProgress('👥 Fetching team members...');
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
      setSyncProgress(`✓ Found ${crewData.data?.length || 0} crew. Fetching properties...`);

      setSyncProgress('🏠 Fetching customer properties...');
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
      setSyncProgress(`✓ Found ${customersData.data?.length || 0} properties. Processing...`);

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
          scheduled_start: job.scheduled_start_time,
          priority: job.is_emergency ? 'high' : 'medium',
        }));

      const transformedCrew = (crewData.data || []).map(member => ({
        id: member.id,
        name: member.name,
        status: member.status,
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
      return true;
    } catch (err) {
      setError(`HouseCall Pro sync failed: ${err.message}`);
      setSyncProgress('❌ HouseCall Pro sync failed');
      return false;
    }
  };

  const handleCsvUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    setSyncProgress('📂 Processing historical CSV from HouseCall Pro...');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const csv = e.target.result;
        const lines = csv.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          throw new Error('CSV file is empty');
        }

        setSyncProgress(`📊 Parsing ${lines.length} rows...`);

        const historicalJobs = [];
        
        for (let i = 1; i < lines.length; i++) {
          try {
            const line = lines[i];
            if (!line.trim()) continue;
            
            const parts = line.split(',');
            if (parts.length < 14) continue;
            
            const jobId = parts[0]?.replace(/[="]/g, '').trim();
            const statusField = parts[1]?.trim();
            const customerName = parts[2]?.replace(/"/g, '').trim();
            const jobDuration = parseFloat(parts[13]?.replace(/"/g, '').trim()) || 0;
            const assignedEmployees = parts[6]?.replace(/"/g, '').trim() || 'Unknown';
            
            if (statusField !== 'Completed' || !jobDuration) continue;
            
            historicalJobs.push({
              job_id: jobId,
              customer: customerName,
              assigned_employees: assignedEmployees,
              actual_duration: Math.round(jobDuration * 60),
            });
          } catch (lineError) {
            continue;
          }
        }

        if (historicalJobs.length === 0) {
          throw new Error('No completed jobs found in CSV.');
        }

        setSyncProgress(`✓ Analyzed ${historicalJobs.length} completed jobs. Calculating crew averages...`);

        const crewAverages = {};
        historicalJobs.forEach(job => {
          const crews = job.assigned_employees.split(',').map(c => c.trim());
          crews.forEach(crew => {
            if (!crewAverages[crew]) {
              crewAverages[crew] = { total: 0, count: 0 };
            }
            crewAverages[crew].total += job.actual_duration;
            crewAverages[crew].count += 1;
          });
        });

        Object.keys(crewAverages).forEach(crew => {
          crewAverages[crew] = Math.round(crewAverages[crew].total / crewAverages[crew].count);
        });

        const historicalContext = {
          total_jobs: historicalJobs.length,
          crew_averages: crewAverages,
          processed_at: new Date().toLocaleTimeString(),
          data_source: 'HouseCall Pro Export',
        };

        setLiveData(prev => ({
          ...prev,
          historicalContext,
        }));

        localStorage.setItem('csv_uploaded', 'true');
        const newSettings = { ...settings, historicalCsvUploaded: true };
        setSettings(newSettings);

        setSyncProgress(`✓ CSV processed: ${historicalJobs.length} jobs analyzed`);
      } catch (err) {
        setError(`CSV processing failed: ${err.message}`);
        setSyncProgress('❌ CSV processing failed');
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
    setSyncProgress('🤖 Claude is optimizing your weekly schedule with live data...');
    setError(null);

    // Format team availability from Lovable MCP
    const teamAvailabilityStr = liveData.teamAvailability.length > 0
      ? JSON.stringify(liveData.teamAvailability, null, 2)
      : 'No Lovable availability data';

    // Format job interactions from Lovable MCP
    const jobInteractionsStr = liveData.jobInteractions.length > 0
      ? JSON.stringify(liveData.jobInteractions, null, 2)
      : 'No job interaction data';

    // Format performance data from Lovable MCP
    const performanceStr = liveData.teamPerformance.length > 0
      ? JSON.stringify(liveData.teamPerformance, null, 2)
      : 'No performance data';

    const dispatchPrompt = `You are an expert dispatcher for American Cleaning Innovations (ACI).

WEEK: ${weeklySchedule.week_start_date} (Wednesday) through ${new Date(new Date(weeklySchedule.week_start_date).getTime() + 6*24*60*60*1000).toISOString().split('T')[0]} (Tuesday)

JOBS FROM HOUSECALL PRO (${liveData.weeklyJobs.length} total):
${JSON.stringify(liveData.weeklyJobs.slice(0, 50), null, 2)}

CREW FROM HOUSECALL PRO:
${JSON.stringify(liveData.availableCrew, null, 2)}

LIVE TEAM AVAILABILITY FROM LOVABLE (via secure MCP server):
${teamAvailabilityStr}

JOB INTERACTIONS & SUCCESS RATES FROM LOVABLE (via secure MCP server):
${jobInteractionsStr}

TEAM PERFORMANCE METRICS FROM LOVABLE (via secure MCP server):
${performanceStr}

HISTORICAL JOB DATA FROM HOUSECALL PRO:
${liveData.historicalContext ? JSON.stringify(liveData.historicalContext, null, 2) : 'No historical data'}

CREW PREFERENCES & CONSTRAINTS:
${weeklySchedule.crew_preferences}

VACATION/UNAVAILABLE DAYS:
${weeklySchedule.vacation_blocks || 'None'}

OPTIMIZATION GOALS (priority order):
1. Same-day turnovers are highest priority - must complete by deadline
2. Respect real-time team availability from Lovable
3. Assign crews to job types they have high success rates on (from interactions)
4. Balance crew workload (no one over 40 hrs/week)
5. Geographic clustering (minimize travel)
6. Consider crew performance history
7. Crew preferences and constraints
8. Recurring clients get same crew when possible

TASK: Generate an optimal weekly dispatch schedule using ALL available data sources:
- Live team availability from Lovable CleanOps
- Historical job performance patterns
- Crew success rates by job type
- Real-time performance metrics

Output as JSON:
{
  "weekly_schedule": [
    {
      "date": "2024-XX-XX",
      "day_of_week": "Wednesday",
      "jobs": [
        {
          "job_id": "...",
          "property": "...",
          "assigned_crew": "...",
          "start_time": "HH:MM",
          "end_time": "HH:MM",
          "confidence": 90,
          "type": "residential|vr_turnover|commercial",
          "rationale": "..."
        }
      ]
    }
  ],
  "crew_utilization": {
    "Name": { "total_hours": 38.5, "jobs": 12, "utilization": 0.96 }
  },
  "data_sources_used": ["HouseCall Pro", "Lovable CleanOps", "Historical Patterns"],
  "summary": "...",
  "risks": [],
  "recommendations": []
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
          max_tokens: 2500,
          messages: [{ role: 'user', content: dispatchPrompt }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Claude API error');
      }

      setSyncProgress('📝 Parsing Claude response...');
      const data = await response.json();
      const responseText = data.content[0].text;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw_response: responseText };

      setDispatchResult(result);
      await savePastSchedule(weeklySchedule.week_start_date, result);
      await loadPastSchedules();

      setSyncProgress('✓ Schedule generated and optimized with live Lovable data');
      setStatus('✓ Weekly schedule optimized with HouseCall Pro + Lovable data.');
    } catch (err) {
      setError(`Claude dispatch failed: ${err.message}`);
      setSyncProgress('❌ Schedule generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateClick = async () => {
    setSyncProgress('');
    setError(null);
    
    // Sync Lovable first via MCP server
    const lovableSuccess = await syncLovableData();
    
    // Then sync HouseCall Pro
    const hcpSuccess = await syncHouseCallPro();
    
    if (lovableSuccess && hcpSuccess) {
      // Finally generate dispatch with all data
      await generateWeeklyDispatch();
    } else if (hcpSuccess) {
      // HCP succeeded but Lovable failed - still generate with HCP data
      setSyncProgress('⚠️ Proceeding without Lovable data...');
      await generateWeeklyDispatch();
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f0f4f8 0%, #d9e8f5 100%)', padding: '2rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', padding: '2rem', marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1f2937', margin: '0 0 0.5rem 0' }}>
            ⚡ ACI Weekly AI Dispatch
          </h1>
          <p style={{ color: '#6b7280', margin: 0 }}>HouseCall Pro + Lovable CleanOps + Claude. Powered by secure MCP server.</p>
        </div>

        {syncProgress && (
          <div style={{ background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', color: '#1e40af' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>🔄 Sync Status:</div>
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

        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
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
                  <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>Include team roles, specialties, and constraints</p>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>Vacation/Unavailable Days</label>
                  <textarea
                    value={weeklySchedule.vacation_blocks}
                    onChange={(e) => setWeeklySchedule({ ...weeklySchedule, vacation_blocks: e.target.value })}
                    style={{ width: '100%', height: '80px', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'sans-serif' }}
                    placeholder="e.g., Ira off Wed-Thu, Tiara unavailable Monday..."
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
                  {loading ? '🔄 Syncing & Generating...' : '⚡ Generate Schedule'}
                </button>

                {dispatchResult && (
                  <div style={{ marginTop: '2rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '4px', padding: '1rem' }}>
                    <h3 style={{ color: '#166534', marginBottom: '1rem' }}>✓ Schedule Generated</h3>
                    {dispatchResult.data_sources_used && (
                      <div style={{ background: 'white', padding: '0.5rem 1rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.875rem' }}>
                        <p style={{ margin: '0 0 0.5rem 0', fontWeight: '600' }}>Data Sources Used:</p>
                        <p style={{ margin: 0, color: '#059669' }}>✓ {dispatchResult.data_sources_used.join(' • ')}</p>
                      </div>
                    )}
                    {dispatchResult.crew_utilization && Object.keys(dispatchResult.crew_utilization).length > 0 && (
                      <div style={{ background: 'white', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
                        <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Crew Utilization:</p>
                        {Object.entries(dispatchResult.crew_utilization).map(([crew, data]) => (
                          <div key={crew} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                            <span>{crew}: {data.total_hours} hrs / {data.jobs} jobs</span>
                            <span style={{ color: data.utilization > 1 ? '#ea580c' : '#15803d' }}>
                              {(data.utilization * 100).toFixed(0)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <details style={{ cursor: 'pointer' }}>
                      <summary style={{ fontWeight: '600', color: '#166534' }}>Full Schedule JSON</summary>
                      <pre style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '4px', overflow: 'auto', maxHeight: '300px', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                        {JSON.stringify(dispatchResult, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            )}

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

            {activeTab === 'settings' && (
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>Setup & Configuration</h2>

                <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '4px' }}>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: '#92400e' }}>
                    🔒 Secure: HouseCall Pro & Claude API keys stored locally. Lovable data accessed securely via MCP server - your data never exposed.
                  </p>
                </div>

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
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>Historical Job Data (HouseCall Pro CSV Export)</label>
                  <input
                    type="file"
                    ref={csvFileRef}
                    onChange={handleCsvUpload}
                    accept=".csv"
                    style={{ width: '100%' }}
                  />
                  <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>Export from HouseCall Pro: Reports → Jobs → Export (select "Completed" status)</p>
                  {settings.historicalCsvUploaded && (
                    <p style={{ fontSize: '0.875rem', color: '#15803d', marginTop: '0.5rem' }}>✓ Historical data loaded</p>
                  )}
                </div>

                {liveData.historicalContext && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '4px', padding: '1rem', marginBottom: '1rem' }}>
                    <p style={{ color: '#166534', margin: 0, fontSize: '0.875rem' }}>
                      ✓ {liveData.historicalContext.total_jobs} completed jobs loaded
                    </p>
                  </div>
                )}

                {liveData.teamAvailability.length > 0 && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '4px', padding: '1rem' }}>
                    <p style={{ color: '#166534', margin: 0, fontSize: '0.875rem' }}>
                      ✓ Lovable MCP: {liveData.teamAvailability.length} availability records synced securely
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '2rem', color: '#6b7280', fontSize: '0.875rem' }}>
          <p>🚀 ACI Weekly AI Dispatch - HouseCall Pro + Lovable CleanOps + Claude (Secure MCP)</p>
        </div>
      </div>
    </div>
  );
};

export default ACIDispatchApp;