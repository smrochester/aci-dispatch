import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Clock, MapPin, User, Plus, RefreshCw, ChevronDown, Calendar, Zap, Database, Plug, Download, Upload } from 'lucide-react';

const ACIDispatchIntegrated = () => {
  const [activeTab, setActiveTab] = useState('settings');
  const [loading, setLoading] = useState(false);
  const [dispatchResult, setDispatchResult] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  
  // Settings & Credentials
  const [settings, setSettings] = useState({
    housecallProApiKey: '',
    housecallProApiUrl: 'https://api.housecallpro.com/v2',
    lovableApiKey: '',
    claudeApiKey: '',
    historicalCsvUploaded: false,
    lastSync: null,
  });

  // Live data from integrations
  const [liveData, setLiveData] = useState({
    todaysJobs: [],
    upcomingJobs: [],
    availableCrew: [],
    properties: [],
    historicalContext: null,
    lastUpdated: null,
  });

  const [dispatchScenario, setDispatchScenario] = useState({
    target_date: 'tomorrow',
    mode: 'auto', // 'auto', 'sameday', 'callout'
    callout_crew: '',
    vr_request: '',
  });

  const csvFileRef = useRef(null);

  // ============================================================
  // STEP 1: SYNC WITH HOUSECALL PRO
  // ============================================================
  const syncHouseCallPro = async () => {
    if (!settings.housecallProApiKey.trim()) {
      setError('Please enter HouseCall Pro API key');
      return;
    }

    setLoading(true);
    setStatus('Syncing with HouseCall Pro...');
    setError(null);

    try {
      // Fetch jobs for today + next 7 days
      const jobsResponse = await fetch(
        `${settings.housecallProApiUrl}/jobs?status=scheduled,in_progress&limit=100`,
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

      // Fetch team members (crew)
      const crewResponse = await fetch(
        `${settings.housecallProApiUrl}/team_members?limit=50`,
        {
          headers: {
            'Authorization': `Bearer ${settings.housecallProApiKey}`,
            'Content-Type': 'application/json',
          }
        }
      );

      const crewData = await crewResponse.json();

      // Fetch customers (properties)
      const customersResponse = await fetch(
        `${settings.housecallProApiUrl}/customers?limit=500`,
        {
          headers: {
            'Authorization': `Bearer ${settings.housecallProApiKey}`,
            'Content-Type': 'application/json',
          }
        }
      );

      const customersData = await customersResponse.json();

      // Transform HouseCall Pro data to our format
      const transformedJobs = (jobsData.data || []).map(job => ({
        id: job.id,
        property: job.customer?.business_name || job.customer?.name || 'Unknown',
        property_id: job.customer?.id,
        type: job.is_emergency ? 'emergency' : job.location?.name?.toLowerCase().includes('vacation') ? 'vr_turnover' : 'residential',
        scheduled_start: job.scheduled_start_time,
        scheduled_end: job.scheduled_end_time,
        duration_estimate: job.estimate_minutes || 120,
        address: job.location?.address,
        assigned_crew: job.assigned_team_member?.name,
        assigned_crew_id: job.assigned_team_member?.id,
        status: job.status,
        priority: job.is_emergency ? 'high' : 'medium',
        notes: job.notes,
      }));

      const transformedCrew = (crewData.data || []).map(member => ({
        id: member.id,
        name: member.name,
        phone: member.phone,
        availability_start: member.availability?.start_time || '08:00',
        availability_end: member.availability?.end_time || '17:00',
        current_location: member.last_location?.address,
        status: member.status,
        is_available: member.status === 'active',
      }));

      const transformedCustomers = (customersData.data || []).map(customer => ({
        id: customer.id,
        name: customer.business_name || customer.name,
        address: customer.primary_address,
        sqft: customer.sqft,
        type: customer.type || 'residential',
        notes: customer.notes,
      }));

      setLiveData(prev => ({
        ...prev,
        todaysJobs: transformedJobs.filter(j => new Date(j.scheduled_start) <= new Date()),
        upcomingJobs: transformedJobs.filter(j => new Date(j.scheduled_start) > new Date()),
        availableCrew: transformedCrew,
        properties: transformedCustomers,
        lastUpdated: new Date().toLocaleTimeString(),
      }));

      setStatus(`✓ Synced: ${transformedJobs.length} jobs, ${transformedCrew.length} crew members`);
    } catch (err) {
      setError(`HouseCall Pro sync failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // STEP 2: UPLOAD HISTORICAL CSV
  // ============================================================
  const handleCsvUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    setStatus('Processing historical CSV...');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const csv = e.target.result;
        const lines = csv.split('\n').slice(1); // Skip header

        // Parse CSV: Date,Property_ID,Cleaner_ID,Duration,Job_Type,Notes
        const historicalJobs = lines
          .filter(line => line.trim())
          .map(line => {
            const [date, property_id, cleaner_id, duration, job_type, notes] = line.split(',');
            return {
              date: date.trim(),
              property_id: property_id.trim(),
              cleaner_id: cleaner_id.trim(),
              actual_duration: parseInt(duration),
              job_type: job_type.trim(),
              notes: notes?.trim(),
            };
          });

        // Analyze patterns
        const avgDurationByType = {};
        const avgDurationByProperty = {};
        const crewSpeedMultipliers = {};

        historicalJobs.forEach(job => {
          // Type-based average
          if (!avgDurationByType[job.job_type]) {
            avgDurationByType[job.job_type] = { total: 0, count: 0 };
          }
          avgDurationByType[job.job_type].total += job.actual_duration;
          avgDurationByType[job.job_type].count += 1;

          // Property-based average
          if (!avgDurationByProperty[job.property_id]) {
            avgDurationByProperty[job.property_id] = { total: 0, count: 0 };
          }
          avgDurationByProperty[job.property_id].total += job.actual_duration;
          avgDurationByProperty[job.property_id].count += 1;

          // Crew speed
          if (!crewSpeedMultipliers[job.cleaner_id]) {
            crewSpeedMultipliers[job.cleaner_id] = { total: 0, count: 0 };
          }
          crewSpeedMultipliers[job.cleaner_id].total += job.actual_duration;
          crewSpeedMultipliers[job.cleaner_id].count += 1;
        });

        // Calculate averages
        Object.keys(avgDurationByType).forEach(type => {
          avgDurationByType[type] = Math.round(
            avgDurationByType[type].total / avgDurationByType[type].count
          );
        });

        Object.keys(avgDurationByProperty).forEach(prop => {
          avgDurationByProperty[prop] = Math.round(
            avgDurationByProperty[prop].total / avgDurationByProperty[prop].count
          );
        });

        // Calculate speed multipliers (relative to average)
        const overallAvg = Object.values(avgDurationByType).reduce((a, b) => a + b, 0) / 
                          Object.values(avgDurationByType).length;
        
        Object.keys(crewSpeedMultipliers).forEach(crew => {
          const crewAvg = crewSpeedMultipliers[crew].total / crewSpeedMultipliers[crew].count;
          crewSpeedMultipliers[crew] = (overallAvg / crewAvg).toFixed(2);
        });

        const historicalContext = {
          total_jobs: historicalJobs.length,
          avg_duration_by_type: avgDurationByType,
          avg_duration_by_property: avgDurationByProperty,
          crew_speed_multipliers: crewSpeedMultipliers,
          processed_at: new Date().toLocaleTimeString(),
        };

        setLiveData(prev => ({
          ...prev,
          historicalContext,
        }));

        setSettings(prev => ({
          ...prev,
          historicalCsvUploaded: true,
        }));

        setStatus(`✓ Processed ${historicalJobs.length} historical jobs. Patterns learned.`);
      } catch (err) {
        setError(`CSV processing failed: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    reader.readAsText(file);
  };

  // ============================================================
  // STEP 3: GENERATE DISPATCH WITH CLAUDE
  // ============================================================
  const generateDispatch = async () => {
    if (!settings.claudeApiKey.trim()) {
      setError('Please enter Claude API key');
      return;
    }

    if (liveData.upcomingJobs.length === 0 && dispatchScenario.mode === 'auto') {
      setError('No upcoming jobs to dispatch. Sync HouseCall Pro first.');
      return;
    }

    setLoading(true);
    setStatus('Claude is optimizing your schedule...');
    setError(null);

    let dispatchPrompt = '';

    if (dispatchScenario.mode === 'auto') {
      // Generate daily dispatch
      dispatchPrompt = `You are an expert dispatcher for American Cleaning Innovations (ACI), a professional cleaning company.

LIVE DATA FROM HOUSECALL PRO:
Jobs scheduled for ${dispatchScenario.target_date}:
${JSON.stringify(liveData.upcomingJobs.slice(0, 10), null, 2)}

Available crew:
${JSON.stringify(liveData.availableCrew, null, 2)}

Properties (with historical context):
${JSON.stringify(liveData.properties, null, 2)}

HISTORICAL PATTERNS (from ${liveData.historicalContext?.total_jobs || 0} completed jobs):
${JSON.stringify(liveData.historicalContext, null, 2)}

TASK:
Optimize the schedule for ${dispatchScenario.target_date}. For each job:
1. Assign to best-fit crew (considering speed, location, preferences)
2. Calculate realistic start/end times based on historical data
3. Estimate confidence level (0-100)
4. Flag risks and contingencies
5. Optimize for geographic clustering (minimize travel time)

Output JSON:
{
  "dispatch_plan": [
    {
      "job_id": "...",
      "property": "...",
      "assigned_crew": "...",
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "confidence": 85,
      "rationale": "...",
      "risks": ["..."],
      "contingency": "..."
    }
  ],
  "summary": "...",
  "total_crew_hours": "...",
  "optimization_notes": "..."
}`;
    } else if (dispatchScenario.mode === 'sameday') {
      // Same-day VR request
      dispatchPrompt = `You are a rapid dispatcher for ACI.

SAME-DAY VR REQUEST:
${dispatchScenario.vr_request}

CURRENT CREW STATUS (from HouseCall Pro):
${JSON.stringify(liveData.availableCrew, null, 2)}

TODAY'S EXISTING JOBS:
${JSON.stringify(liveData.todaysJobs, null, 2)}

TASK:
Determine if this VR turnover is feasible TODAY. Return:
{
  "feasible": true/false,
  "recommended_crew": "...",
  "arrival_time": "...",
  "completion_time": "...",
  "confidence": 0-100,
  "rationale": "...",
  "alternatives": ["..."]
}`;
    } else if (dispatchScenario.mode === 'callout') {
      // Callout reassignment
      dispatchPrompt = `You are an emergency dispatcher for ACI.

CREW CALLOUT:
Crew member "${dispatchScenario.callout_crew}" has called out.

THEIR SCHEDULED JOBS TODAY:
${JSON.stringify(liveData.todaysJobs.filter(j => j.assigned_crew === dispatchScenario.callout_crew), null, 2)}

OTHER AVAILABLE CREW:
${JSON.stringify(liveData.availableCrew.filter(c => c.name !== dispatchScenario.callout_crew), null, 2)}

TASK:
Generate instant reassignment plan. For each affected job:
- Reassign to another crew OR reschedule
- Prioritize VR turnovers (hard deadline)
- Provide client notification templates

Return JSON:
{
  "reassignments": [
    {
      "job_id": "...",
      "action": "reassign" | "reschedule",
      "new_crew": "...",
      "new_time": "...",
      "client_message": "..."
    }
  ],
  "summary": "..."
}`;
    }

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
      setStatus('✓ Dispatch optimized. Review and confirm.');
    } catch (err) {
      setError(`Claude dispatch failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // UI TABS
  // ============================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Plug className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-800">ACI AI Dispatch (Integrated)</h1>
          </div>
          <p className="text-gray-600">Connected to HouseCall Pro + Lovable + Claude. Real-time dispatch optimization.</p>
        </div>

        {/* Status & Error Alerts */}
        {status && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
            <Zap className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-blue-700">{status}</p>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="flex border-b flex-wrap">
            {[
              { id: 'settings', label: '⚙️ Setup', icon: Database },
              { id: 'dispatch', label: '📅 Daily Dispatch', icon: Calendar },
              { id: 'sameday', label: '⚡ Same-Day VR', icon: Zap },
              { id: 'callout', label: '🚨 Callout', icon: AlertCircle },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-4 px-4 text-center font-semibold transition-all text-sm md:text-base ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* TAB 1: SETUP */}
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Database className="w-6 h-6" />
                  Integration Setup
                </h2>
                <p className="text-gray-600">Connect your data sources. One-time setup.</p>

                <div className="space-y-4">
                  {/* HouseCall Pro */}
                  <div className="border border-gray-300 rounded-lg p-4">
                    <label className="block text-sm font-semibold mb-2">HouseCall Pro API Key</label>
                    <input
                      type="password"
                      placeholder="Your HouseCall Pro API key"
                      value={settings.housecallProApiKey}
                      onChange={(e) => setSettings({ ...settings, housecallProApiKey: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3"
                    />
                    <a href="https://www.housecallpro.com/integrations" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">
                      Get your API key from HouseCall Pro Settings
                    </a>
                    <button
                      onClick={syncHouseCallPro}
                      disabled={loading || !settings.housecallProApiKey}
                      className="mt-3 w-full bg-green-600 text-white font-semibold py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                    >
                      {loading ? 'Syncing...' : '🔄 Sync HouseCall Pro'}
                    </button>
                  </div>

                  {/* Lovable (Optional) */}
                  <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                    <label className="block text-sm font-semibold mb-2">Lovable API Key (Optional)</label>
                    <input
                      type="password"
                      placeholder="Your Lovable API key"
                      value={settings.lovableApiKey}
                      onChange={(e) => setSettings({ ...settings, lovableApiKey: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <p className="text-xs text-gray-600 mt-2">Optional. Used for VR booking data if you have it.</p>
                  </div>

                  {/* Claude API */}
                  <div className="border border-blue-300 rounded-lg p-4 bg-blue-50">
                    <label className="block text-sm font-semibold mb-2">Claude API Key</label>
                    <input
                      type="password"
                      placeholder="sk-ant-..."
                      value={settings.claudeApiKey}
                      onChange={(e) => setSettings({ ...settings, claudeApiKey: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <a href="https://console.anthropic.com/api/keys" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline mt-2">
                      Get key from Anthropic Console
                    </a>
                  </div>

                  {/* Historical CSV Upload */}
                  <div className="border border-purple-300 rounded-lg p-4 bg-purple-50">
                    <label className="block text-sm font-semibold mb-2">Upload Historical Job Data (CSV)</label>
                    <p className="text-xs text-gray-600 mb-3">
                      Format: Date, Property_ID, Cleaner_ID, Duration_Minutes, Job_Type, Notes
                    </p>
                    <input
                      type="file"
                      ref={csvFileRef}
                      onChange={handleCsvUpload}
                      accept=".csv"
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-700"
                    />
                    {settings.historicalCsvUploaded && (
                      <p className="text-xs text-green-600 mt-2">✓ Historical data loaded</p>
                    )}
                  </div>
                </div>

                {/* Status Summary */}
                {liveData.availableCrew.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-green-800">✓ Connection Status</p>
                    <ul className="text-sm text-green-700 mt-2 space-y-1">
                      <li>✓ HouseCall Pro: {liveData.availableCrew.length} crew members synced</li>
                      <li>✓ Jobs: {liveData.upcomingJobs.length} upcoming jobs</li>
                      {liveData.historicalContext && (
                        <li>✓ Historical data: {liveData.historicalContext.total_jobs} jobs analyzed</li>
                      )}
                      <li>Last updated: {liveData.lastUpdated}</li>
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: DAILY DISPATCH */}
            {activeTab === 'dispatch' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Calendar className="w-6 h-6" />
                  Generate Dispatch Schedule
                </h2>
                <p className="text-gray-600">Claude will optimize all jobs from HouseCall Pro for tomorrow (or selected date).</p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2">Target Date</label>
                    <select
                      value={dispatchScenario.target_date}
                      onChange={(e) => setDispatchScenario({ ...dispatchScenario, target_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="tomorrow">Tomorrow</option>
                      <option value="today">Today (remaining jobs)</option>
                      <option value="next_week">This Week (Mon-Fri)</option>
                    </select>
                  </div>

                  <button
                    onClick={() => {
                      setDispatchScenario({ ...dispatchScenario, mode: 'auto' });
                      generateDispatch();
                    }}
                    disabled={loading || liveData.upcomingJobs.length === 0}
                    className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2"
                  >
                    {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                    Generate Optimized Schedule
                  </button>
                </div>

                {dispatchResult && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h3 className="font-bold text-green-800 mb-3">✓ Schedule Optimized</h3>
                    <pre className="bg-white p-3 rounded border border-green-200 overflow-auto max-h-96 text-xs font-mono">
                      {JSON.stringify(dispatchResult, null, 2)}
                    </pre>
                    <button
                      onClick={() => {
                        const dataStr = JSON.stringify(dispatchResult, null, 2);
                        const dataBlob = new Blob([dataStr], { type: 'application/json' });
                        const url = URL.createObjectURL(dataBlob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `dispatch_${new Date().toISOString().slice(0, 10)}.json`;
                        link.click();
                      }}
                      className="mt-3 text-sm text-blue-600 underline"
                    >
                      📥 Download as JSON
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: SAME-DAY VR */}
            {activeTab === 'sameday' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Zap className="w-6 h-6 text-orange-500" />
                  Instant VR Feasibility Check
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2">Turnover Request</label>
                    <textarea
                      value={dispatchScenario.vr_request}
                      onChange={(e) => setDispatchScenario({ ...dispatchScenario, vr_request: e.target.value })}
                      placeholder="e.g., Beachfront Condo - guest checks in 3:00 PM, turnover needed by 2:45 PM, est. 2.5 hours"
                      className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  <button
                    onClick={() => {
                      setDispatchScenario({ ...dispatchScenario, mode: 'sameday' });
                      generateDispatch();
                    }}
                    disabled={loading || !dispatchScenario.vr_request}
                    className="w-full bg-orange-600 text-white font-semibold py-3 rounded-lg hover:bg-orange-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2"
                  >
                    {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                    Check Feasibility (Instant)
                  </button>
                </div>

                {dispatchResult && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-bold text-blue-800 mb-3">Decision</h3>
                    <pre className="bg-white p-3 rounded border border-blue-200 overflow-auto max-h-96 text-xs font-mono">
                      {JSON.stringify(dispatchResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: CALLOUT */}
            {activeTab === 'callout' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <AlertCircle className="w-6 h-6 text-red-600" />
                  Emergency Callout Response
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2">Crew Member Called Out</label>
                    <select
                      value={dispatchScenario.callout_crew}
                      onChange={(e) => setDispatchScenario({ ...dispatchScenario, callout_crew: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="">Select crew member...</option>
                      {liveData.availableCrew.map(crew => (
                        <option key={crew.id} value={crew.name}>{crew.name}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => {
                      setDispatchScenario({ ...dispatchScenario, mode: 'callout' });
                      generateDispatch();
                    }}
                    disabled={loading || !dispatchScenario.callout_crew}
                    className="w-full bg-red-600 text-white font-semibold py-3 rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2"
                  >
                    {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <AlertCircle className="w-5 h-5" />}
                    Generate Reassignment Plan
                  </button>
                </div>

                {dispatchResult && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h3 className="font-bold text-red-800 mb-3">Reassignment Plan</h3>
                    <pre className="bg-white p-3 rounded border border-red-200 overflow-auto max-h-96 text-xs font-mono">
                      {JSON.stringify(dispatchResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-gray-600">
          <p>HouseCall Pro + Lovable + Claude. Your data stays secure. API keys are not stored.</p>
        </div>
      </div>
    </div>
  );
};

export default ACIDispatchIntegrated;