import React, { useState, useEffect, useRef } from 'react';

const ACIDispatchApp = () => {
  const [activeTab, setActiveTab] = useState('weekly');
  const [loading, setLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [dispatchResult, setDispatchResult] = useState(null);
  const [dailyBrief, setDailyBrief] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [savedSchedules, setSavedSchedules] = useState([]);
  
  const [settings, setSettings] = useState({
    housecallProApiKey: localStorage.getItem('hcp_key') || '',
    claudeApiKey: localStorage.getItem('claude_key') || '',
    historicalCsvUploaded: !!localStorage.getItem('csv_uploaded'),
    lastSync: localStorage.getItem('last_sync'),
  });

  const [lovableData, setLovableData] = useState({
    employees: [],
    availability: [],
    jobs: [],
    assignments: [],
    whatsappSessions: [],
    properties: [],
    clients: [],
    timeEntries: [],
    qaFindings: [],
    bookings: [],
    lastUpdated: null,
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
    crew_preferences: 'Ira leads North (Melbourne). Leslie leads South (Palm Bay, dividing line Melbourne North). Terra floats. Porshua DEDICATED to Beach Island only. Tiara & McKayla always together (McKayla drives).',
    vacation_blocks: '',
  });

  const csvFileRef = useRef(null);
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

      setSyncProgress('📅 Loading scheduled jobs and bookings...');
      const jobsResult = await queryMCPServer('get_jobs', {
        start_date: startDate,
        end_date: endDate,
      });
      if (!jobsResult.success) throw new Error(`Failed to get jobs: ${jobsResult.error}`);

      setSyncProgress('🔗 Checking current assignments...');
      const assignmentsResult = await queryMCPServer('get_assignments');
      if (!assignmentsResult.success) throw new Error(`Failed to get assignments: ${assignmentsResult.error}`);

      setSyncProgress('💬 Analyzing crew engagement history...');
      const whatsappResult = await queryMCPServer('get_whatsapp_sessions', { days: 30 });

      setSyncProgress('🏠 Loading property details and requirements...');
      const propertiesResult = await queryMCPServer('get_properties');
      if (!propertiesResult.success) throw new Error(`Failed to get properties: ${propertiesResult.error}`);

      setSyncProgress('👤 Loading client info and preferences...');
      const clientsResult = await queryMCPServer('get_clients');
      if (!clientsResult.success) throw new Error(`Failed to get clients: ${clientsResult.error}`);

      setSyncProgress('⏱️ Analyzing historical time entries...');
      const timeEntriesResult = await queryMCPServer('get_time_entries', { days: 90 });

      setSyncProgress('🔍 Checking QA findings and quality issues...');
      const qaResult = await queryMCPServer('get_qa_findings', { days: 60 });

      setSyncProgress('🛏️ Loading guest bookings and turnover info...');
      const bookingsResult = await queryMCPServer('get_bookings', {
        start_date: startDate,
        end_date: endDate,
      });

      setLovableData({
        employees: employeesResult.data?.employees || [],
        availability: availabilityResult.data?.availability || [],
        jobs: jobsResult.data?.jobs || [],
        assignments: assignmentsResult.data?.assignments || [],
        whatsappSessions: whatsappResult.data?.sessions || [],
        properties: propertiesResult.data?.properties || [],
        clients: clientsResult.data?.clients || [],
        timeEntries: timeEntriesResult.data?.time_entries || [],
        qaFindings: qaResult.data?.findings || [],
        bookings: bookingsResult.data?.bookings || [],
        lastUpdated: new Date().toLocaleTimeString(),
      });

      setSyncProgress(`✓ CleanOps synced: ${(employeesResult.data?.employees || []).length} employees, ${(jobsResult.data?.jobs || []).length} jobs`);
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

      if (!jobsResponse.ok) throw new Error(`HouseCall Pro API error: ${jobsResponse.status}`);

      const jobsData = await jobsResponse.json();
      setSyncProgress(`✓ Found ${jobsData.data?.length || 0} jobs. Fetching crew...`);

      setSyncProgress('👥 Fetching team members...');
      const crewResponse = await fetch(
        `https://api.housecallpro.com/v2/team_members?limit=50`,
        { headers: { 'Authorization': `Bearer ${settings.housecallProApiKey}`, 'Content-Type': 'application/json' } }
      );

      const crewData = await crewResponse.json();
      setSyncProgress(`✓ Found ${crewData.data?.length || 0} crew. Fetching properties...`);

      setSyncProgress('🏠 Fetching customer properties...');
      const customersResponse = await fetch(
        `https://api.housecallpro.com/v2/customers?limit=500`,
        { headers: { 'Authorization': `Bearer ${settings.housecallProApiKey}`, 'Content-Type': 'application/json' } }
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
        
        if (lines.length < 2) throw new Error('CSV file is empty');

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

        if (historicalJobs.length === 0) throw new Error('No completed jobs found in CSV.');

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

        setLiveData(prev => ({ ...prev, historicalContext }));
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
    setSyncProgress('🤖 Claude is analyzing your complete operational picture...');
    setError(null);

    const dispatchPrompt = `You are an expert dispatcher for American Cleaning Innovations (ACI) with deep knowledge of crew dynamics, geographic constraints, and operational rules.

IMPORTANT: You understand:
- Ira leads North (Melbourne base), Leslie leads South (Palm Bay base)
- Porshua is DEDICATED to Beach Island Resort only (never assign elsewhere)
- Tiara & McKayla are a team (always together, McKayla doesn't drive)
- Same-day turnovers with hard guest check-ins = highest priority
- New crew (Porshua day 2, Christina, Stephanie) = pair with experienced leads
- Geographic clustering: Cocoa Beach → Melbourne Beach → Satellite Beach is natural path
- Elise Johnson properties have special laundry coordination needs
- Lead + new crew combo is ONE unit of work (one supervising, one training)

WEEK: ${weeklySchedule.week_start_date} (Wednesday) through ${new Date(new Date(weeklySchedule.week_start_date).getTime() + 6*24*60*60*1000).toISOString().split('T')[0]} (Tuesday)

JOBS TO SCHEDULE (${liveData.weeklyJobs.length} total):
${JSON.stringify(liveData.weeklyJobs.slice(0, 50), null, 2)}

CREW ROSTER (from Lovable CleanOps):
${JSON.stringify(lovableData.employees.slice(0, 20), null, 2)}

TEAM AVAILABILITY (Live from Lovable):
${JSON.stringify(lovableData.availability, null, 2)}

PROPERTIES & REQUIREMENTS:
${JSON.stringify(lovableData.properties.slice(0, 15), null, 2)}

CLIENT INFO & RISK STATUS:
${JSON.stringify(lovableData.clients.slice(0, 15), null, 2)}

QA FINDINGS (Last 60 days - quality issues by crew):
${lovableData.qaFindings.length > 0 ? JSON.stringify(lovableData.qaFindings.slice(0, 10), null, 2) : 'No issues'}

GUEST BOOKINGS & TURNOVER DEADLINES:
${JSON.stringify(lovableData.bookings.slice(0, 10), null, 2)}

HISTORICAL PATTERNS:
${liveData.historicalContext ? JSON.stringify(liveData.historicalContext, null, 2) : 'No historical data'}

CREW PREFERENCES:
${weeklySchedule.crew_preferences}

VACATION/UNAVAILABLE:
${weeklySchedule.vacation_blocks || 'None'}

TASK: Generate optimal weekly dispatch schedule respecting all constraints and business rules:
1. Same-day turnovers = highest priority (hard guest check-in times)
2. Porshua ONLY Beach Island Resort
3. Tiara & McKayla always together
4. New crew paired with experienced leads (1:1 supervision ratio)
5. Geographic clustering (minimize backtracking)
6. Leslie starts Palm Bay, then known recurring client
7. Leads supervise their zones primarily
8. Leave 1-2 experienced crew flexible for callouts

Output JSON with DETAILED crew assignments and reasoning:
{
  "weekly_schedule": [
    {
      "date": "2024-XX-XX",
      "day_of_week": "Wednesday",
      "jobs": [
        {
          "job_id": "...",
          "property": "...",
          "assigned_crew": "Name1, Name2",
          "start_time": "HH:MM",
          "end_time": "HH:MM",
          "confidence": 95,
          "is_same_day_turnover": true,
          "guest_checkin_time": "3:00 PM",
          "rationale": "Same-day priority with hard 3PM deadline. Assigned [crew] because [geographic/experience reason]",
          "crew_details": {
            "lead": "Name (role)",
            "support": "Name (reason)",
            "geographic_logic": "..."
          }
        }
      ]
    }
  ],
  "crew_utilization": { "Name": { "total_hours": 38.5, "jobs": 12, "utilization": 0.96 } },
  "crew_briefing_notes": {
    "Porshua": "Beach Island only - Cocoa area. Arinique supervises.",
    "Tiara & McKayla": "Team: Melbourne. [Property assignments]",
    "Leslie": "Palm Bay lead. Start estimate, then [recurring property]"
  },
  "data_sources_used": ["HouseCall Pro", "Lovable CleanOps", "QA History", "Bookings"],
  "summary": "..."
}`;

    try {
      setSyncProgress('📤 Sending comprehensive operational data to Claude...');
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.claudeApiKey,
        },
        body: JSON.stringify({
          model: 'claude-opus-4-20250514',
          max_tokens: 3500,
          messages: [{ role: 'user', content: dispatchPrompt }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Claude API error');
      }

      setSyncProgress('🧠 Claude is reasoning about your complete operation...');
      const data = await response.json();
      const responseText = data.content[0].text;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw_response: responseText };

      setDispatchResult(result);
      await savePastSchedule(weeklySchedule.week_start_date, result);
      await loadPastSchedules();

      setSyncProgress('✓ Optimal schedule generated using all operational data');
      setStatus('✓ Schedule optimized with complete CleanOps intelligence.');
    } catch (err) {
      setError(`Claude dispatch failed: ${err.message}`);
      setSyncProgress('❌ Schedule generation failed');
    } finally {
      setLoading(false);
    }
  };

  const generateDailyBrief = async (day) => {
    if (!dispatchResult || !dispatchResult.weekly_schedule) {
      setError('Generate a schedule first');
      return;
    }

    if (!settings.claudeApiKey.trim()) {
      setError('Please enter Claude API key');
      return;
    }

    setLoading(true);
    setSyncProgress('📋 Generating detailed daily brief...');
    setError(null);

    const dayData = dispatchResult.weekly_schedule.find(d => d.date === day);
    if (!dayData) {
      setError('Day not found in schedule');
      setLoading(false);
      return;
    }

    const briefPrompt = `You are creating a DETAILED DAILY SCHEDULING BRIEF for the ACI cleaning team. This is what crew will see in the morning and use throughout the day.

DATE: ${day} (${dayData.day_of_week})

JOBS ASSIGNED FOR THIS DAY:
${JSON.stringify(dayData.jobs, null, 2)}

CREW PROFILES (Locations & Specialties):
- Ira (North Lead, Melbourne): Same-day turnovers, inspections, training
- Leslie (South Lead, Palm Bay): Recurring clients, estimates
- Terra (Floating, Palm Bay base): Coverage & backup
- Sandy (Cocoa Beach): Solo jobs, geographic east side
- Alice (Melbourne): Experienced, flexible, fill-in jobs
- Tiara & McKayla (Melbourne): Team (always together, McKayla in passenger seat)
- Porshua (Cocoa): BEACH ISLAND RESORT ONLY
- Christina Charles (Melbourne): New, needs lead pairing
- Stephanie Fennel (Cocoa): New but experienced, solo on known clients
- Tara Miller (Melbourne): Recurring clients

PROPERTIES WITH SPECIAL NOTES:
- Beach Island Resort (Cocoa Beach): Porshua dedicated. Multiple same-day = need 3 staff total
- Elise Johnson properties: Special laundry coordination (pick up at office for most, except Orlando property)
- Properties in Satellite Beach: Cluster with Melbourne Beach properties
- Laughing Tree (Satellite Beach): Can be solo (Sandy proven capable)

TASK: Create a DETAILED morning briefing document that the team can reference throughout the day. Include:

1. SAME-DAY TURNOVER ALERTS (hard deadlines)
2. CREW ASSIGNMENTS with DETAILED instructions
3. GEOGRAPHIC ROUTING (minimize backtracking)
4. PROPERTY SPECIAL NOTES (laundry, requirements, risks)
5. TIMING & BUFFER ZONES
6. COORDINATION NOTES (crew that need to work together)
7. CONTINGENCY CONTACTS
8. SPECIAL INSTRUCTIONS (inspections, photo docs, etc)

Format as a readable morning briefing that crew will actually use. Include:
- Who works where and when
- Actual start/end times
- Drive time between properties
- Any special requirements
- Who to contact if running late
- Backup crew assignments if someone calls out

Make it practical, detailed, and actionable.`;

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
          messages: [{ role: 'user', content: briefPrompt }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Claude API error');
      }

      setSyncProgress('📝 Formatting daily brief...');
      const data = await response.json();
      const responseText = data.content[0].text;

      setDailyBrief({
        date: day,
        dayOfWeek: dayData.day_of_week,
        jobs: dayData.jobs,
        briefContent: responseText,
      });

      setSelectedDay(day);
      setSyncProgress('✓ Daily brief generated');
    } catch (err) {
      setError(`Brief generation failed: ${err.message}`);
      setSyncProgress('❌ Brief generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateClick = async () => {
    setSyncProgress('');
    setError(null);
    
    const lovableSuccess = await syncLovableData();
    const hcpSuccess = await syncHouseCallPro();
    
    if (lovableSuccess && hcpSuccess) {
      await generateWeeklyDispatch();
    } else if (hcpSuccess) {
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
          <p style={{ color: '#6b7280', margin: 0 }}>Complete CleanOps Intelligence + Daily Scheduling Briefs</p>
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

        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
            {[
              { id: 'weekly', label: '📊 Weekly Dispatch' },
              { id: 'daily', label: '📋 Daily Briefs' },
              { id: 'history', label: '📚 Past Schedules' },
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
                    
                    {dispatchResult.crew_briefing_notes && (
                      <div style={{ background: 'white', padding: '1rem', borderRadius: '4px', marginBottom: '1rem', border: '1px solid #d1d5db' }}>
                        <p style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#166534' }}>Crew Briefing Notes:</p>
                        {Object.entries(dispatchResult.crew_briefing_notes).map(([crew, note]) => (
                          <div key={crew} style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                            <span style={{ fontWeight: '600' }}>{crew}:</span> {note}
                          </div>
                        ))}
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

                    {dispatchResult.weekly_schedule && (
                      <div style={{ background: 'white', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
                        <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Daily Breakdown:</p>
                        {dispatchResult.weekly_schedule.map(day => (
                          <button
                            key={day.date}
                            onClick={() => setActiveTab('daily')}
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '0.5rem',
                              marginBottom: '0.25rem',
                              background: '#f9fafb',
                              border: '1px solid #e5e7eb',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.875rem',
                            }}
                          >
                            {day.date} ({day.day_of_week}): {day.jobs.length} jobs
                          </button>
                        ))}
                      </div>
                    )}

                    <details style={{ cursor: 'pointer' }}>
                      <summary style={{ fontWeight: '600', color: '#166534' }}>Full Schedule JSON</summary>
                      <pre style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '4px', overflow: 'auto', maxHeight: '400px', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                        {JSON.stringify(dispatchResult, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'daily' && (
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>Daily Scheduling Briefs</h2>
                
                {dispatchResult && dispatchResult.weekly_schedule ? (
                  <div>
                    <p style={{ marginBottom: '1rem', color: '#6b7280', fontSize: '0.875rem' }}>Click a day to generate a detailed crew briefing</p>
                    
                    {dispatchResult.weekly_schedule.map(day => (
                      <button
                        key={day.date}
                        onClick={() => generateDailyBrief(day.date)}
                        disabled={loading}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '1rem',
                          marginBottom: '0.5rem',
                          background: selectedDay === day.date ? '#dbeafe' : '#f9fafb',
                          border: selectedDay === day.date ? '2px solid #2563eb' : '1px solid #e5e7eb',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: '600' }}>{day.date} ({day.day_of_week})</div>
                        <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                          {day.jobs.length} jobs assigned
                          {day.jobs.some(j => j.is_same_day_turnover) && ' • ⚡ Same-day turnovers included'}
                        </div>
                      </button>
                    ))}

                    {dailyBrief && dailyBrief.date === selectedDay && (
                      <div style={{ marginTop: '2rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '4px', padding: '1.5rem' }}>
                        <h3 style={{ color: '#166534', marginBottom: '1rem' }}>📋 Daily Scheduling Brief - {dailyBrief.date}</h3>
                        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '4px', fontSize: '0.95rem', lineHeight: '1.6', whiteSpace: 'pre-wrap', fontFamily: 'system-ui' }}>
                          {dailyBrief.briefContent}
                        </div>
                        <button
                          onClick={() => {
                            const element = document.createElement('a');
                            element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(dailyBrief.briefContent));
                            element.setAttribute('download', `ACI_Brief_${dailyBrief.date}.txt`);
                            element.style.display = 'none';
                            document.body.appendChild(element);
                            element.click();
                            document.body.removeChild(element);
                          }}
                          style={{
                            marginTop: '1rem',
                            padding: '0.5rem 1rem',
                            background: '#2563eb',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: '600',
                          }}
                        >
                          📥 Download Brief
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p style={{ color: '#6b7280' }}>Generate a weekly schedule first to view daily briefs</p>
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
                    🔒 Secure MCP: Claude accesses Lovable via 11 tools. API keys never exposed.
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
                </div>

                <div style={{ marginBottom: '1.5rem', border: '1px solid #d1d5db', borderRadius: '4px', padding: '1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>Historical Job Data (HouseCall Pro CSV)</label>
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
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '2rem', color: '#6b7280', fontSize: '0.875rem' }}>
          <p>🚀 ACI Weekly AI Dispatch + Daily Scheduling Briefs</p>
        </div>
      </div>
    </div>
  );
};

export default ACIDispatchApp;