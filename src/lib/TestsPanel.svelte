<script>
  import { marked } from 'marked';

  let { 
    visible = $bindable(false),
    onSessionSelect = () => {}
  } = $props();

  let pastSessions = $state([]);
  let selectedSession = $state(null);
  let loadingSessions = $state(false);
  let searchQuery = $state('');
  let filterAgentType = $state('all');
  let filterCountry = $state('all');

  const API_URL = 'http://localhost:17001';

  marked.setOptions({
    breaks: true,
    gfm: true
  });

  // Load past test sessions from the database
  async function loadPastSessions() {
    loadingSessions = true;
    const url = `${API_URL}/api/test-sessions?limit=50`;
    console.log('[TestsPanel] Loading sessions from:', url);
    try {
      const response = await fetch(url);

      console.log('[TestsPanel] Response status:', response.status);
      console.log('[TestsPanel] Response headers:', Object.fromEntries(response.headers.entries()));

      const data = await response.json();
      console.log('[TestsPanel] Response data:', data);

      if (data.success) {
        pastSessions = data.sessions || [];
        console.log('[TestsPanel] Loaded sessions:', pastSessions.length);
      } else {
        console.error('[TestsPanel] Failed to load sessions:', data.error);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[TestsPanel] Error loading sessions:', error);
        console.error('[TestsPanel] Error name:', error.name);
        console.error('[TestsPanel] Error message:', error.message);
      }
    } finally {
      loadingSessions = false;
    }
  }

  // Search sessions
  async function searchSessions() {
    if (!searchQuery.trim()) {
      loadPastSessions();
      return;
    }

    loadingSessions = true;
    try {
      const response = await fetch(`${API_URL}/api/test-sessions/search/${encodeURIComponent(searchQuery)}`);
      const data = await response.json();
      
      if (data.success) {
        pastSessions = data.sessions || [];
      }
    } catch (error) {
      console.error('Error searching sessions:', error);
    } finally {
      loadingSessions = false;
    }
  }

  // Filter sessions
  async function filterSessions() {
    loadingSessions = true;
    try {
      const filters = {};
      if (filterAgentType !== 'all') filters.agentType = filterAgentType;
      if (filterCountry !== 'all') filters.country = filterCountry;

      const response = await fetch(`${API_URL}/api/test-sessions/filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters)
      });
      const data = await response.json();
      
      if (data.success) {
        pastSessions = data.sessions || [];
      }
    } catch (error) {
      console.error('Error filtering sessions:', error);
    } finally {
      loadingSessions = false;
    }
  }

  // Delete a session
  async function deleteSession(sessionId) {
    if (!confirm('Are you sure you want to delete this test session?')) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/test-sessions/${sessionId}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      
      if (data.success) {
        pastSessions = pastSessions.filter(s => s.sessionId !== sessionId);
        if (selectedSession?.sessionId === sessionId) {
          selectedSession = null;
        }
      }
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  }

  // Select a session to view
  function selectSession(session) {
    selectedSession = session;
    onSessionSelect(session);
  }

  // Format date
  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString();
  }

  // Get score color
  function getScoreColor(score) {
    if (score >= 8) return '#4ade80';
    if (score >= 6) return '#fbbf24';
    return '#f87171';
  }

  // Load sessions when panel becomes visible
  let previousVisible = false;
  $effect(() => {
    if (visible && !previousVisible) {
      previousVisible = true;
      loadPastSessions();
    } else if (!visible) {
      previousVisible = false;
    }
  });

  // Watch for filter changes
  $effect(() => {
    if (filterAgentType !== 'all' || filterCountry !== 'all') {
      filterSessions();
    }
  });
</script>

{#if visible}
<div class="tests-panel-overlay" role="button" tabindex="0" onclick={() => visible = false} onkeydown={(e) => e.key === 'Escape' && (visible = false)}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tests-panel" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <div class="panel-header">
      <h2>Past Test Sessions</h2>
      <button class="close-btn" onclick={() => visible = false}>✕</button>
    </div>

    <div class="panel-controls">
      <div class="search-bar">
        <input 
          type="text" 
          bind:value={searchQuery}
          placeholder="Search sessions..."
          onkeydown={(e) => e.key === 'Enter' && searchSessions()}
        />
        <button onclick={searchSessions}>Search</button>
      </div>

      <div class="filters">
        <select bind:value={filterAgentType}>
          <option value="all">All Agents</option>
          <option value="home_chat">Home Chat AI</option>
          <option value="case_ai">Case AI</option>
        </select>

        <select bind:value={filterCountry}>
          <option value="all">All Countries</option>
          <option value="UK">UK</option>
          <option value="USA">USA</option>
          <option value="Canada">Canada</option>
        </select>

        <button onclick={loadPastSessions}>Refresh</button>
      </div>
    </div>

    <div class="sessions-list">
      {#if loadingSessions}
        <div class="loading">Loading sessions...</div>
      {:else if pastSessions.length === 0}
        <div class="empty">No test sessions found</div>
      {:else}
        {#each pastSessions as session}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="session-card"
            class:selected={selectedSession?.sessionId === session.sessionId}
            role="button"
            tabindex="0"
            onclick={() => selectSession(session)}
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSession(session)}
          >
            <div class="session-header">
              <div class="session-info">
                <span class="agent-type">{session.agentType === 'home_chat' ? 'Home Chat AI' : 'Case AI'}</span>
                <span class="country">{session.country}</span>
              </div>
              <div class="session-score" style="color: {getScoreColor(session.overallScore)}">
                {session.overallScore?.toFixed(1) || 'N/A'}
              </div>
            </div>

            <div class="session-meta">
              <div class="meta-item">
                <span class="meta-label">Tasks:</span>
                <span class="meta-value">{session.completedTasks || 0}/{session.totalTasks || 0}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Date:</span>
                <span class="meta-value">{formatDate(session.timestamp)}</span>
              </div>
            </div>

            <div class="session-actions">
              <button 
                class="view-btn"
                onclick={(e) => {
                  e.stopPropagation();
                  selectSession(session);
                }}
              >
                View Details
              </button>
              <button 
                class="delete-btn"
                onclick={(e) => {
                  e.stopPropagation();
                  deleteSession(session.sessionId);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
{/if}

<style>
  .tests-panel-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .tests-panel {
    background: #0a0e14;
    border: 2px solid #3d2a2f;
    border-radius: 8px;
    width: 90%;
    max-width: 1200px;
    height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 30px;
    border-bottom: 2px solid #3d2a2f;
    background: #2d1a1f;
  }

  .panel-header h2 {
    margin: 0;
    color: #e8d8d0;
    font-size: 24px;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    color: #e8d8d0;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.2s;
  }

  .close-btn:hover {
    background: rgba(232, 216, 208, 0.1);
  }

  .panel-controls {
    padding: 20px 30px;
    border-bottom: 1px solid #3d2a2f;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .search-bar {
    display: flex;
    gap: 8px;
  }

  .search-bar input {
    flex: 1;
    background: #1a1520;
    border: 1px solid #3d2a2f;
    color: #e8d8d0;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
  }

  .search-bar input:focus {
    outline: none;
    border-color: #d4a574;
  }

  .search-bar button,
  .filters button {
    background: #d4a574;
    color: #0a0e14;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    transition: background 0.2s;
  }

  .search-bar button:hover,
  .filters button:hover {
    background: #e8d8d0;
  }

  .filters {
    display: flex;
    gap: 8px;
  }

  .filters select {
    background: #1a1520;
    border: 1px solid #3d2a2f;
    color: #e8d8d0;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
  }

  .filters select:focus {
    outline: none;
    border-color: #d4a574;
  }

  .sessions-list {
    flex: 1;
    overflow-y: auto;
    padding: 20px 30px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .loading,
  .empty {
    text-align: center;
    color: #8b7a6f;
    padding: 40px;
    font-size: 16px;
  }

  .session-card {
    background: #1a1520;
    border: 1px solid #3d2a2f;
    border-radius: 6px;
    padding: 16px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .session-card:hover {
    border-color: #d4a574;
    background: #2d1a1f;
  }

  .session-card.selected {
    border-color: #d4a574;
    background: #2d1a1f;
  }

  .session-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .session-info {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .agent-type {
    color: #d4a574;
    font-weight: 600;
    font-size: 14px;
  }

  .country {
    color: #8b7a6f;
    font-size: 14px;
    padding: 2px 8px;
    background: rgba(212, 165, 116, 0.1);
    border-radius: 4px;
  }

  .session-score {
    font-size: 24px;
    font-weight: 700;
  }

  .session-meta {
    display: flex;
    gap: 20px;
    margin-bottom: 12px;
  }

  .meta-item {
    display: flex;
    gap: 6px;
    font-size: 13px;
  }

  .meta-label {
    color: #8b7a6f;
  }

  .meta-value {
    color: #e8d8d0;
  }

  .session-actions {
    display: flex;
    gap: 8px;
  }

  .view-btn,
  .delete-btn {
    padding: 6px 12px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: all 0.2s;
  }

  .view-btn {
    background: #d4a574;
    color: #0a0e14;
  }

  .view-btn:hover {
    background: #e8d8d0;
  }

  .delete-btn {
    background: rgba(248, 113, 113, 0.2);
    color: #f87171;
  }

  .delete-btn:hover {
    background: rgba(248, 113, 113, 0.3);
  }

  .sessions-list::-webkit-scrollbar {
    width: 8px;
  }

  .sessions-list::-webkit-scrollbar-track {
    background: #1a1520;
  }

  .sessions-list::-webkit-scrollbar-thumb {
    background: #3d2a2f;
    border-radius: 4px;
  }

  .sessions-list::-webkit-scrollbar-thumb:hover {
    background: #4d3a3f;
  }
</style>

