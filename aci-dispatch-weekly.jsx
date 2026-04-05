import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Clock, MapPin, User, Plus, RefreshCw, ChevronDown, Calendar, Zap, Database, Plug, Download, Upload, BarChart3, TrendingUp } from 'lucide-react';

const ACIDispatchWeekly = () => {
  const [activeTab, setActiveTab] = useState('weekly');
  const [loading, setLoading] = useState(false);
  const [dispatchResult, setDispatchResult] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  
  // Settings & Credentials
  const [settings, setSettings] = useState({
    housecallProApiKey: '',
    housecallProApiUrl: 'https://api.anthropic.com/v2',
    claudeApiKey: '',
    historicalCsvUploaded: false,
    lastSync: null,
  });

  // Live data from integrations
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
    week_type: 'wed_to_tue', // Wed-Tue payroll week
    mode: 'optimize', // 'optimize', 'adjust', 'analyze'
    adjustment_requests: '',
    crew_preferences: 'Standard rotation',
    budget_constraints: 'No constraints',
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

  // ============================================================
  // SYNC WITH HOUSECALL PRO
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
      // Calculate week range (Wednesday to Tuesday)
      const startDate = new Date(weeklySchedule.week_start_date);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6); // Wed to next Tue = 6 days ahead

      // Fetch jobs for the week
      const jobsResponse = await fetch(
        `${settings.housecallProApiUrl}/jobs?status=scheduled,in_progress&limit=200`,
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

      // Filter jobs for this week only
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
        weekly_hours_available: 40, // Standard 40 hr week
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

      setStatus(`✓ Synced week of ${weeklySchedule.week_start_date}: ${transformedJobs.length} jobs, ${transformedCrew.length} crew members`);
    } catch (err) {
      setError(`HouseCall Pro sync failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // UPLOAD HISTORICAL CSV
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
        const avgDurationByProperty = {};
        const crewSpeedMultipliers = {};
        const dayOfWeekPatterns = {};

        historicalJobs.forEach(job => {
          const jobDate = new Date(job.date);
          const dayName = jobDate.toLocaleString('en-US', { weekday: 'long' });

          if (!avgDurationByType[job.job_type]) {
            avgDurationByType[job.job_type] = { total: 0, count: 0 };
          }
          avgDurationByType[job.job_type].total += job.actual_duration;
          avgDurationByType[job.job_type].count += 1;

          if (!avgDurationByProperty[job.property_id]) {
            avgDurationByProperty[job.property_id] = { total: 0, count: 0 };
          }
          avgDurationByProperty[job.property_id].total += job.actual_duration;
          avgDurationByProperty[job.property_id].count += 1;

          if (!crewSpeedMultipliers[job.cleaner_id]) {
            crewSpeedMultipliers[job.cleaner_id] = { total: 0, count: 0 };
          }
          crewSpeedMultipliers[job.cleaner_id].total += job.actual_duration;
          crewSpeedMultipliers[job.cleaner_id].count += 1;

          if (!dayOfWeekPatterns[dayName]) {
            dayOfWeekPatterns[dayName] = { total: 0, count: 0 };
          }
          dayOfWeekPatterns[dayName].total += job.actual_duration;
          dayOfWeekPatterns[dayName].count += 1;
        });

        Object.keys(avgDurationByType).forEach(type => {
          avgDurationByType[type] = Math.round(avgDurationByType[type].total / avgDurationByType[type].count);
        });

        Object.keys(avgDurationByProperty).forEach(prop => {
          avgDurationByProperty[prop] = Math.round(
            avgDurationByProperty[prop].total / avgDurationByProperty[prop].count
          );
        });

        const overallAvg = Object.values(avgDurationByType).reduce((a, b) => a + b, 0) / 
                          Object.values(avgDurationByType).length;
        
        Object.keys(crewSpeedMultipliers).forEach(crew => {
          const crewAvg = crewSpeedMultipliers[crew].total / crewSpeedMultipliers[crew].count;
          crewSpeedMultipliers[crew] = (overallAvg / crewAvg).toFixed(2);
        });

        Object.keys(dayOfWeekPatterns).forEach(day => {
          dayOfWeekPatterns[day] = Math.round(dayOfWeekPatterns[day].total / dayOfWeekPatterns[day].count);
        });

        const historicalContext = {
          total_jobs: historicalJobs.length,
          avg_duration_by_type: avgDurationByType,
          avg_duration_by_property: avgDurationByProperty,
          crew_speed_multipliers: crewSpeedMultipliers,
          day_of_week_patterns: dayOfWeekPatterns,
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

        setStatus(`✓ Processed ${historicalJobs.length} historical jobs. Day patterns learned.`);
      } catch (err) {
        setError(`CSV processing failed: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    reader.readAsText(file);
  };

  // ============================================================
  // GENERATE WEEKLY DISPATCH WITH CLAUDE
  // ============================================================
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

    const dispatchPrompt = `You are an expert dispatcher for American Cleaning Innovations (ACI), a professional cleaning company.

Your task: Create an optimal weekly dispatch schedule for a Wed-Tue payroll week.

WEEK: ${weeklySchedule.week_start_date} (Wednesday) through ${new Date(new Date(weeklySchedule.week_start_date).getTime() + 6*24*60*60*1000).toISOString().split('T')[0]} (Tuesday)

JOBS TO SCHEDULE (${liveData.weeklyJobs.length} total):
${JSON.stringify(liveData.weeklyJobs.slice(0, 50), null, 2)}

AVAILABLE CREW (40 hours/week each):
${JSON.stringify(liveData.availableCrew, null, 2)}

HISTORICAL PATTERNS (from ${liveData.historicalContext?.total_jobs || 0} completed jobs):
${JSON.stringify(liveData.historicalContext, null, 2)}

CREW PREFERENCES & CONSTRAINTS:
${weeklySchedule.crew_preferences}

VACATION/UNAVAILABLE BLOCKS:
${weeklySchedule.vacation_blocks || 'None'}

OPTIMIZATION GOALS (in priority order):
1. Respect hard deadlines (VR turnovers, time-sensitive jobs)
2. Balance crew workload (no one over 40 hrs/week, minimize overtime)
3. Geographic clustering (minimize travel time)
4. Crew preferences (Sarah downtown, John north county, etc.)
5. Recurring clients get same crew when possible
6. Build buffer time for overruns
7. Minimize week-to-week transitions (crew continuity)

TASK:
Generate a complete weekly schedule showing:
- For EACH job: Assigned crew, start time, end time, confidence level
- Daily breakdown (Wed, Thu, Fri, Mon, Tue)
- Crew utilization (hours per crew, load balance)
- Risk assessment (what could go wrong?)
- Recommended adjustments for next week
- VR turnover success probability

Output as JSON:
{
  "weekly_schedule": [
    {
      "date": "2024-01-17",
      "day_of_week": "Wednesday",
      "jobs": [
        {
          "job_id": "...",
          "property": "...",
          "assigned_crew": "...",
          "start_time": "HH:MM",
          "end_time": "HH:MM",
          "duration_minutes": 150,
          "confidence": 90,
          "type": "residential|vr_turnover|commercial",
          "rationale": "..."
        }
      ]
    }
  ],
  "crew_utilization": {
    "Sarah": { "total_hours": 38.5, "jobs": 12, "utilization": 0.96 },
    "John": { "total_hours": 40, "jobs": 10, "utilization": 1.0 }
  },
  "weekly_summary": {
    "total_jobs": 50,
    "total_crew_hours_needed": 150,
    "avg_confidence": 88,
    "vr_success_rate": 98
  },
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
      setStatus('✓ Weekly schedule optimized. Review and distribute.');
    } catch (err) {
      setError(`Claude dispatch failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // ANALYZE WEEKLY PERFORMANCE
  // ============================================================
  const analyzeWeeklyPerformance = async () => {
    if (!dispatchResult) {
      setError('Generate a schedule first to analyze performance');
      return;
    }

    setStatus('Analyzing weekly performance metrics...');

    const analysisPrompt = `Given this weekly dispatch schedule:
${JSON.stringify(dispatchResult, null, 2)}

Provide a performance analysis including:
1. Crew balance analysis: Is workload distributed fairly?
2. Geographic efficiency: How optimized are routes?
3. Risk summary: What's the biggest vulnerability this week?
4. VR turnover success probability: Will deadlines be met?
5. Recommendations for next week

Format as JSON with clear metrics and insights.`;

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
          messages: [{ role: 'user', content: analysisPrompt }]
        })
      });

      if (!response.ok) throw new Error('Analysis failed');
      const data = await response.json();
      const responseText = data.content[0].text;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      
      setDispatchResult(prev => ({
        ...prev,
        performance_analysis: jsonMatch ? JSON.parse(jsonMatch[0]) : responseText
      }));
      
      setStatus('✓ Analysis complete.');
    } catch (err) {
      setError(`Analysis failed: ${err.message}`);
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
            <TrendingUp className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-800">ACI Weekly AI Dispatch</h1>
          </div>
          <p className="text-gray-600">Plan your entire Wed-Tue payroll week in one go. Balance crew loads, optimize routes, guarantee VR deadlines.</p>
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
              { id: 'weekly', label: '📊 Weekly Dispatch', icon: Calendar },
              { id: 'settings', label: '⚙️ Setup', icon: Database },
              { id: 'analysis', label: '📈 Performance', icon: BarChart3 },
              { id: 'adjustments', label: '🔧 Adjustments', icon: RefreshCw },
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
            {/* TAB 1: WEEKLY DISPATCH */}
            {activeTab === 'weekly' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Calendar className="w-6 h-6" />
                  Generate Weekly Schedule (Wed-Tue Payroll)
                </h2>
                <p className="text-gray-600">Claude will optimize all jobs for the week, balance crew loads, and guarantee VR turnover deadlines.</p>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold mb-2">Week Start Date (Wednesday)</label>
                      <input
                        type="date"
                        value={weeklySchedule.week_start_date}
                        onChange={(e) => {
                          setWeeklySchedule({ ...weeklySchedule, week_start_date: e.target.value });
                          // Trigger re-sync when week changes
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">Week Type</label>
                      <select
                        value={weeklySchedule.week_type}
                        onChange={(e) => setWeeklySchedule({ ...weeklySchedule, week_type: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      >
                        <option value="wed_to_tue">Wed-Tue (Payroll Week)</option>
                        <option value="mon_to_fri">Mon-Fri (5-day)</option>
                        <option value="sun_to_sat">Sun-Sat (Calendar Week)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold mb-2">Crew Preferences & Constraints</label>
                    <textarea
                      value={weeklySchedule.crew_preferences}
                      onChange={(e) => setWeeklySchedule({ ...weeklySchedule, crew_preferences: e.target.value })}
                      placeholder="e.g., Sarah prefers downtown; John unavailable Mon morning; Patricia doesn't do VR turnovers"
                      className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold mb-2">Vacation / Unavailable Days</label>
                    <textarea
                      value={weeklySchedule.vacation_blocks}
                      onChange={(e) => setWeeklySchedule({ ...weeklySchedule, vacation_blocks: e.target.value })}
                      placeholder="e.g., Sarah off Wed-Thu; John off Monday"
                      className="w-full h-16 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  <button
                    onClick={() => {
                      setWeeklySchedule({ ...weeklySchedule, mode: 'optimize' });
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
                      <h3 className="font-bold text-green-800 mb-3">✓ Weekly Schedule Optimized</h3>
                      
                      {/* Daily Breakdown */}
                      {dispatchResult.weekly_schedule && (
                        <div className="space-y-3 mb-4">
                          {dispatchResult.weekly_schedule.slice(0, 7).map((day, idx) => (
                            <div key={idx} className="bg-white p-3 rounded border border-green-100">
                              <p className="font-semibold text-gray-800">{day.day_of_week} ({day.date})</p>
                              <p className="text-sm text-gray-600 mt-1">{day.jobs?.length || 0} jobs scheduled</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Crew Utilization Summary */}
                      {dispatchResult.crew_utilization && (
                        <div className="bg-white p-3 rounded border border-green-100 mt-3">
                          <p className="font-semibold text-gray-800 mb-2">Crew Utilization</p>
                          {Object.entries(dispatchResult.crew_utilization).map(([crew, data]) => (
                            <div key={crew} className="flex justify-between text-sm text-gray-700">
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
                        📥 Download Weekly Schedule
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={analyzeWeeklyPerformance}
                        className="flex-1 bg-indigo-600 text-white font-semibold py-2 rounded-lg hover:bg-indigo-700 transition"
                      >
                        📈 Analyze Performance
                      </button>
                      <button
                        onClick={() => setActiveTab('adjustments')}
                        className="flex-1 bg-orange-600 text-white font-semibold py-2 rounded-lg hover:bg-orange-700 transition"
                      >
                        🔧 Make Adjustments
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: SETUP */}
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Database className="w-6 h-6" />
                  Integration Setup
                </h2>

                <div className="space-y-4">
                  <div className="border border-gray-300 rounded-lg p-4">
                    <label className="block text-sm font-semibold mb-2">HouseCall Pro API Key</label>
                    <input
                      type="password"
                      placeholder="hcp_..."
                      value={settings.housecallProApiKey}
                      onChange={(e) => setSettings({ ...settings, housecallProApiKey: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3"
                    />
                    <a href="https://www.housecallpro.com/integrations" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">
                      Get your API key from HouseCall Pro Settings
                    </a>
                  </div>

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

                {liveData.availableCrew.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-green-800">✓ Connected</p>
                    <ul className="text-sm text-green-700 mt-2 space-y-1">
                      <li>✓ HouseCall Pro: {liveData.availableCrew.length} crew members</li>
                      <li>✓ Properties: {liveData.properties.length} locations</li>
                      {liveData.historicalContext && (
                        <li>✓ Historical data: {liveData.historicalContext.total_jobs} jobs analyzed</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: PERFORMANCE ANALYSIS */}
            {activeTab === 'analysis' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <BarChart3 className="w-6 h-6" />
                  Weekly Performance Analysis
                </h2>

                {dispatchResult?.performance_analysis ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <pre className="bg-white p-3 rounded border border-blue-200 overflow-auto max-h-96 text-xs font-mono">
                      {JSON.stringify(dispatchResult.performance_analysis, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-600 mb-4">Generate a weekly schedule first, then click "Analyze Performance"</p>
                    <button
                      onClick={() => setActiveTab('weekly')}
                      className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
                    >
                      Go to Weekly Dispatch
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: ADJUSTMENTS */}
            {activeTab === 'adjustments' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <RefreshCw className="w-6 h-6" />
                  Make Adjustments to This Week's Schedule
                </h2>

                {dispatchResult ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold mb-2">What Would You Like to Change?</label>
                      <textarea
                        value={weeklySchedule.adjustment_requests}
                        onChange={(e) => setWeeklySchedule({ ...weeklySchedule, adjustment_requests: e.target.value })}
                        placeholder="e.g., Move John's Monday job to Friday; Give Sarah one less VR turnover; Add buffer time between Property 1 and 2"
                        className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>

                    <button
                      onClick={() => {
                        setWeeklySchedule({ ...weeklySchedule, mode: 'adjust' });
                        generateWeeklyDispatch();
                      }}
                      disabled={loading || !weeklySchedule.adjustment_requests}
                      className="w-full bg-orange-600 text-white font-semibold py-3 rounded-lg hover:bg-orange-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2"
                    >
                      {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                      Re-Optimize with Adjustments
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-600 mb-4">Generate a weekly schedule first to make adjustments</p>
                    <button
                      onClick={() => setActiveTab('weekly')}
                      className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
                    >
                      Go to Weekly Dispatch
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-gray-600">
          <p>Plan your entire Wed-Tue payroll week on Sunday. Adjust once if needed. Done for the week.</p>
        </div>
      </div>
    </div>
  );
};

export default ACIDispatchWeekly;