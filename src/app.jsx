import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Clock, MapPin, User, Plus, RefreshCw, ChevronDown, Calendar, Zap, Database, Plug, Download, Upload, BarChart3, TrendingUp, Cloud, Save } from 'lucide-react';

// Firebase initialization (optional, will work without it)
let db = null;
let firebaseReady = false;

const initializeFirebase = async () => {
  if (typeof window !== 'undefined' && !firebaseReady) {
    try {
      if (process.env.REACT_APP_FIREBASE_API_KEY) {
        const { initializeApp } = await import('firebase/app');
        const { getDatabase } = await import('firebase/database');
        
        const firebaseConfig = {
          apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
          authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
          databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL,
          projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
          storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
          appId: process.env.REACT_APP_FIREBASE_APP_ID,
        };
        
        const app = initializeApp(firebaseConfig);
        db = getDatabase(app);
        firebaseReady = true;
      }
    } catch (err) {
      console.log('Firebase offline mode; data will be stored locally');
    }
  }
};

const ACIDispatchApp = () => {
  const [activeTab, setActiveTab] = useState('weekly');
  const [loading, setLoading] = useState(false);
  const [dispatchResult, setDispatchResult] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [savedSchedules, setSavedSchedules] = useState([]);
  
  // Settings & Credentials
  const [settings, setSettings] = useState({
    housecallProApiKey: localStorage.getItem('hcp_key') || '',
    claudeApiKey: localStorage.getItem('claude_key') || '',
    historicalCsvUploaded: !!localStorage.getItem('csv_uploaded'),
    lastSync: localStorage.getItem('last_sync'),
  });

  // Live data
  const [liveData, setLiveData] = useState({
    weeklyJobs: [],
    availableCrew: [],
    properties: [],
    historicalContext: null,
    lastUpdated: null,
  });

  // Weekly scheduling
  const [weeklySchedule, setWeeklySchedule] = useState({
    week_start_date: getNextWednesday(),
    week_type: 'wed_to_tue',
    mode: 'optimize',
    adjustment_requests: '',
    crew_preferences: 'Standard rotation',
    vacation_blocks: '',
  });

  const csvFileRef = useRef(null);

  // Helper: Get next Wednesday
  function getNextWednesday() {
    const today = new Date();
    const day = today.getDay();
    const daysUntilWednesday = (3 - day + 7) % 7 || 7;
    const nextWednesday = new Date(today);
    nextWednesday.setDate(today.getDate() + daysUntilWednesday);
    return nextWednesday.toISOString().split('T')[0];
  }

  // Initialize Firebase on mount
  useEffect(() => {
    initializeFirebase();
    loadPastSchedules();
  }, []);

  // Save to Firebase
  const saveToFirebase = async (path, data) => {
    if (firebaseReady && db) {
      try {
        const { ref, set } = await import('firebase/database');
        await set(ref(db, path), {
          ...data,
          saved_at: new Date().toISOString(),
        });
        return true;
      } catch (err) {
        console.log('Firebase save failed; using local storage');
        return false;
      }
    }
    return false;
  };

  const savePastSchedule = async (weekStart, scheduleData) => {
    // Save to Firebase
    await saveToFirebase(`schedules/${weekStart}`, scheduleData);

    // Also save to local storage as backup
    const allSchedules = JSON.parse(localStorage.getItem('past_schedules') || '{}');
    allSchedules[weekStart] = scheduleData;
    localStorage.setItem('past_schedules', JSON.stringify(allSchedules));

    setStatus(`✓ Schedule saved`);
  };

  const loadPastSchedules = async () => {
    const schedules = JSON.parse(localStorage.getItem('past_schedules') || '{}');
    setSavedSchedules(Object.keys(schedules).sort().reverse());
  };

  // Sync with HouseCall Pro
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

      // Fetch jobs
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

      // Fetch crew
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

      // Fetch customers
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

      // Transform data
      const transformedJobs = (jobsData.data || [])
        .filter(job => {
          const jobDate = new Date(job.scheduled_start_time);
          return jobDate >= startDate && jobDate <= endDate;
        })
        .map(job => ({
          id: job.id,
          property: job.customer?.business_name || job.customer?.name || 'Unknown',
          property_id: job.customer?.id,
          type: job.location?.name?.toLowerCase().includes('vacation') ? 'vr_turnover' : 'residential',
          scheduled_start: job.scheduled_start_time,
          scheduled_end: job.scheduled_end_time,
          duration_estimate: job.estimate_minutes || 120,
          address: job.location?.address,
          assigned_crew: job.assigned_team_member?.name,
          assigned_crew_id: job.assigned_team_member?.id,
          status: job.status,
          priority: job.is_emergency ? 'high' : 'medium',
          notes: job.notes,
          day_of_week: new Date(job.scheduled_start_time).toLocaleString('en-US', { weekday: 'short' }),
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
        weekly_hours_available: 40,
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

  // Upload CSV
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
        const crewSpeedMultipliers = {};

        historicalJobs.forEach(job => {
          if (!avgDurationByType[job.job_type]) {
            avgDurationByType[job.job_type] = { total: 0, count: 0 };
          }
          avgDurationByType[job.job_type].total += job.actual_duration;
          avgDurationByType[job.job_type].count += 1;

          if (!crewSpeedMultipliers[job.cleaner_id]) {
            crewSpeedMultipliers[job.cleaner_id] = { total: 0, count: 0 };
          }
          crewSpeedMultipliers[job.cleaner_id].total += job.actual_duration;
          crewSpeedMultipliers[job.cleaner_id].count += 1;
        });

        Object.keys(avgDurationByType).forEach(type => {
          avgDurationByType[type] = Math.round(avgDurationByType[type].total / avgDurationByType[type].count);
        });

        const overallAvg = Object.values(avgDurationByType).reduce((a, b) => a + b, 0) / 
                          Object.values(avgDurationByType).length;
        
        Object.keys(crewSpeedMultipliers).forEach(crew => {
          const crewAvg = crewSpeedMultipliers[crew].total / crewSpeedMultipliers[crew].count;
          crewSpeedMultipliers[crew] = (overallAvg / crewAvg).toFixed(2);
        });

        const historicalContext = {
          total_jobs: historicalJobs.length,
          avg_duration_by_type: avgDurationByType,
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

  // Generate dispatch
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
${JSON.stringify(liveData.weeklyJobs.slice(0, 50), null, 2)}

CREW (40 hours/week each):
${JSON.stringify(liveData.availableCrew, null, 2)}

HISTORICAL PATTERNS:
${JSON.stringify(liveData.historicalContext, null, 2)}

CREW PREFERENCES:
${weeklySchedule.crew_preferences}

VACATION/UNAVAILABLE:
${weeklySchedule.vacation_blocks || 'None'}

OPTIMIZATION GOALS (priority order):
1. Respect hard deadlines (VR turnovers)
2. Balance crew workload (no one over 40 hrs)
3. Geographic clustering
4. Crew preferences
5. Recurring clients stay with same crew
6. Build buffer time

TASK: Generate weekly schedule with crew assignments, start/end times, confidence levels, risks, and contingencies.

Output JSON:
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
          "type": "residential|vr_turnover|commercial"
        }
      ]
    }
  ],
  "crew_utilization": {
    "Name": { "total_hours": 38.5, "jobs": 12, "utilization": 0.96 }
  },
  "summary": "...",
  "risks": ["..."],
  "recommendations": ["..."]
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
          max_tokens: 4000,
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Cloud className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-800">ACI Weekly AI Dispatch</h1>
            <span className="text-sm bg-green-100 text-green-800 px-3 py-1 rounded-full">Live</span>
          </div>
          <p className="text-gray-600">Wed-Tue payroll week planning. Sync live data. Optimize dispatch.</p>
        </div>

        {/* Status & Error */}
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
              { id: 'weekly', label: '📊 Weekly Dispatch' },
              { id: 'history', label: '📋 Past Schedules' },
              { id: 'settings', label: '⚙️ Setup' },
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
            {/* TAB: WEEKLY DISPATCH */}
            {activeTab === 'weekly' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Calendar className="w-6 h-6" />
                  Generate Weekly Schedule
                </h2>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold mb-2">Week Start (Wed)</label>
                      <input
                        type="date"
                        value={weeklySchedule.week_start_date}
                        onChange={(e) => setWeeklySchedule({ ...weeklySchedule, week_start_date: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold mb-2">Crew Preferences</label>
                    <textarea
                      value={weeklySchedule.crew_preferences}
                      onChange={(e) => setWeeklySchedule({ ...weeklySchedule, crew_preferences: e.target.value })}
                      placeholder="e.g., Ira leads North, Leslie leads South, Porshua dedicated Beach Island..."
                      className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold mb-2">Vacation/Unavailable Days</label>
                    <textarea
                      value={weeklySchedule.vacation_blocks}
                      onChange={(e) => setWeeklySchedule({ ...weeklySchedule, vacation_blocks: e.target.value })}
                      placeholder="e.g., Ira off Wed-Thu, Tiara unavailable Monday..."
                      className="w-full h-16 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  <button
                    onClick={() => {
                      syncHouseCallPro().then(() => generateWeeklyDispatch());
                    }}
                    disabled={loading || !settings.housecallProApiKey || !settings.claudeApiKey}
                    className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2"
                  >
                    {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                    Generate Weekly Optimized Schedule
                  </button>
                </div>

                {dispatchResult && (
                  <div className="space-y-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h3 className="font-bold text-green-800 mb-3">✓ Weekly Schedule Generated</h3>
                      
                      {dispatchResult.crew_utilization && (
                        <div className="bg-white p-3 rounded border border-green-100">
                          <p className="font-semibold text-gray-800 mb-2">Crew Utilization</p>
                          {Object.entries(dispatchResult.crew_utilization).map(([crew, data]) => (
                            <div key={crew} className="flex justify-between text-sm text-gray-700 mb-1">
                              <span>{crew}: {data.total_hours} hrs / {data.jobs} jobs</span>
                              <span className={data.utilization > 1 ? 'text-orange-600' : 'text-green-600'}>
                                {(data.utilization * 100).toFixed(0)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      <button
                        onClick={() => {
                          const dataStr = JSON.stringify(dispatchResult, null, 2);
                          const dataBlob = new Blob([dataStr], { type: 'application/json' });
                          const url = URL.createObjectURL(dataBlob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `weekly_dispatch_${weeklySchedule.week_start_date}.json`;
                          link.click();
                        }}
                        className="mt-3 text-sm text-blue-600 underline"
                      >
                        📥 Download JSON
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB: PAST SCHEDULES */}
            {activeTab === 'history' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold">📋 Past Weekly Schedules</h2>
                
                {savedSchedules.length > 0 ? (
                  <div className="space-y-2">
                    {savedSchedules.map(week => (
                      <button
                        key={week}
                        onClick={() => {
                          const allSchedules = JSON.parse(localStorage.getItem('past_schedules') || '{}');
                          setDispatchResult(allSchedules[week]);
                          setWeeklySchedule({ ...weeklySchedule, week_start_date: week });
                          setActiveTab('weekly');
                        }}
                        className="w-full text-left p-3 bg-gray-50 border border-gray-300 rounded-lg hover:bg-gray-100 transition"
                      >
                        <p className="font-semibold text-gray-800">Week of {week}</p>
                        <p className="text-sm text-gray-600">Wed-Tue payroll week</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-600">No schedules saved yet. Generate your first schedule above.</p>
                )}
              </div>
            )}

            {/* TAB: SETTINGS */}
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold">⚙️ Setup & Configuration</h2>

                <div className="space-y-4">
                  <div className="border border-gray-300 rounded-lg p-4">
                    <label className="block text-sm font-semibold mb-2">HouseCall Pro API Key</label>
                    <input
                      type="password"
                      placeholder="hcp_..."
                      value={settings.housecallProApiKey}
                      onChange={(e) => {
                        setSettings({ ...settings, housecallProApiKey: e.target.value });
                        localStorage.setItem('hcp_key', e.target.value);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2"
                    />
                    <p className="text-xs text-gray-600">Get from HouseCall Pro Settings → Integrations → API</p>
                  </div>

                  <div className="border border-blue-300 rounded-lg p-4 bg-blue-50">
                    <label className="block text-sm font-semibold mb-2">Claude API Key</label>
                    <input
                      type="password"
                      placeholder="sk-ant-..."
                      value={settings.claudeApiKey}
                      onChange={(e) => {
                        setSettings({ ...settings, claudeApiKey: e.target.value });
                        localStorage.setItem('claude_key', e.target.value);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2"
                    />
                    <p className="text-xs text-gray-600">Get from <a href="https://console.anthropic.com/api/keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Anthropic Console</a></p>
                  </div>

                  <div className="border border-purple-300 rounded-lg p-4 bg-purple-50">
                    <label className="block text-sm font-semibold mb-2">Historical Job Data (CSV)</label>
                    <input
                      type="file"
                      ref={csvFileRef}
                      onChange={handleCsvUpload}
                      accept=".csv"
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-600 file:text-white"
                    />
                    {settings.historicalCsvUploaded && (
                      <p className="text-xs text-green-600 mt-2">✓ Historical data loaded</p>
                    )}
                  </div>

                  {settings.lastSync && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <p className="text-sm text-green-800">
                        ✓ Last synced: {new Date(settings.lastSync).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-gray-600">
          <p>🚀 ACI Weekly AI Dispatch - Plan your entire week on Sunday. Optimize automatically.</p>
        </div>
      </div>
    </div>
  );
};

export default ACIDispatchApp;