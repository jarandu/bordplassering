<script lang="ts">
  import { onMount } from 'svelte';
  import { parseCSV, optimizeSeating, assignToTables, type TableAssignment, type DistanceFunction, type OptimizationMode } from './lib/seating';
  import TableVisual from './lib/TableVisual.svelte';
  
  let csvInput = $state('');
  let tableSizes = $state<number[]>([8, 8, 8, 8, 8]);
  let attempts = $state(100);
  let distanceFunction = $state<DistanceFunction>('commonality');
  let optimizationMode = $state<OptimizationMode>('poor_connections');
  let isProcessing = $state(false);
  let progress = $state('');
  let result = $state<TableAssignment | null>(null);
  let errorMessage = $state('');
  let logs = $state<string[]>([]);

  const numberOfPeople = $derived(parseCSV(csvInput).length);
  
  // Load from localStorage
  onMount(() => {
    const saved = localStorage.getItem('tableSizes');
    if (saved) {
      try {
        tableSizes = JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved table sizes');
      }
    }
  });
  
  // Save to localStorage when tableSizes change
  $effect(() => {
    localStorage.setItem('tableSizes', JSON.stringify(tableSizes));
  });
  
  function addTable() {
    const unAssignedSeats = numberOfPeople - totalSeats;
    tableSizes = [...tableSizes, unAssignedSeats > 0 ? unAssignedSeats : 0];
  }
  
  function removeTable(index: number) {
    tableSizes = tableSizes.filter((_, i) => i !== index);
  }
  
  // Calculate total available seats
  let totalSeats = $derived(tableSizes.reduce((sum, size) => sum + size, 0));
  
  async function handleOptimize() {
    const startTime = performance.now();
    try {
      errorMessage = '';
      result = null;
      logs = [];
      isProcessing = true;
      progress = 'Parser CSV...';
      logs = [...logs, '📄 Starter parsing av CSV...'];
      
      const people = parseCSV(csvInput);
      logs = [...logs, `✅ Fant ${people.length} personer i CSV-filen`];
      
      console.time('Optimalisering');
      
      if (people.length === 0) {
        errorMessage = 'Ingen gyldige personer funnet i CSV-en';
        isProcessing = false;
        return;
      }
      
      // Check if there are enough seats
      if (people.length > totalSeats) {
        errorMessage = `⚠️ For mange personer! Du har ${people.length} personer, men bare ${totalSeats} plasser. Legg til flere bord eller øk bordstørrelse.`;
        logs = [...logs, `❌ FEIL: ${people.length} personer > ${totalSeats} plasser`];
        isProcessing = false;
        return;
      }
      
      logs = [...logs, `📊 Totalt ${totalSeats} plasser på ${tableSizes.length} bord`];
      
      if (people.length < totalSeats) {
        logs = [...logs, `⚠️ ${totalSeats - people.length} ledige plasser`];
        progress = `⚠️ Merk: ${people.length} personer fordelt på ${totalSeats} plasser (${totalSeats - people.length} ledige). Starter optimalisering...`;
      } else {
        progress = `Fant ${people.length} personer. Starter optimalisering...`;
      }
      
      logs = [...logs, `🔧 Bruker ${distanceFunction === 'commonality' ? 'felleshet' : 'gjennomsnittlig avstand'} som avstandsmetode`];
      logs = [...logs, `🎯 Optimaliserer for ${optimizationMode === 'poor_connections' ? 'dårlige forbindelser' : 'total avstand'}`];
      logs = [...logs, `🔄 Starter ${attempts} simuleringer...`];
      
      // Small delay to allow UI to update
      await new Promise(resolve => setTimeout(resolve, 100));
      
      let lastLoggedAttempt = 0;
      let tempLogs: string[] = [];
      const seatingResult = optimizeSeating(
        people, 
        attempts, 
        distanceFunction,
        optimizationMode,
        (attempt: number, score: number) => {
          const scoreLabel = optimizationMode === 'distance' 
            ? `${score.toFixed(2)} total avstand`
            : `${score} personer med ≤2 felles tema`;
          
          // Only update UI every 20 attempts to avoid slowdown
          if (attempt % 20 === 0 || attempt === 1) {
            progress = `Forsøk ${attempt}/${attempts}: Beste score = ${scoreLabel}`;
          }
          
          // Batch logs instead of updating array each time
          if (attempt - lastLoggedAttempt >= 25 || attempt === 1) {
            tempLogs.push(`  ↻ Forsøk ${attempt}: Score = ${scoreLabel}`);
            lastLoggedAttempt = attempt;
          }
        }
      );
      
      // Add batched logs at once
      logs = [...logs, ...tempLogs];
      
      logs = [...logs, `✨ Beste løsning funnet!`];
      const finalLabel = optimizationMode === 'distance'
        ? `${seatingResult.score.toFixed(2)} total avstand`
        : `${seatingResult.score} personer med ≤2 felles tema`;
      logs = [...logs, `📈 Final score: ${finalLabel}`];
      
      progress = 'Plasserer personer på bord...';
      logs = [...logs, `🪑 Plasserer personer på bord i slange-mønster...`];
      
      console.timeEnd('Optimalisering');
      console.time('Bordplassering');
      console.log('📊 tableSizes:', tableSizes);
      console.log('👥 Antall personer:', people.length);
      
      result = assignToTables(seatingResult, tableSizes);
      console.timeEnd('Bordplassering');
      
      console.log('🪑 Result tables:', result.tables.length);
      result.tables.forEach((t, i) => {
        console.log(`  Bord ${i + 1}: ${t.seats.length} seter, ${t.seats.filter(s => s !== null).length} personer`);
      });
      
      // Batch all final logs together
      const finalLogs = [
        `✅ Ferdig! Plassering fullført.`,
        `📊 Opprettet ${result.tables.length} bord`
      ];
      
      const stats3Plus = result.statistics.filter(s => s.commonThemes.length > 2).length;
      const stats2 = result.statistics.filter(s => s.commonThemes.length === 2).length;
      const stats1 = result.statistics.filter(s => s.commonThemes.length === 1).length;
      const stats0 = result.statistics.filter(s => s.commonThemes.length === 0).length;
      
      finalLogs.push(`📋 ${stats3Plus} personer har 3+ felles tema`);
      finalLogs.push(`📋 ${stats2} personer har 2 felles tema`);
      finalLogs.push(`📋 ${stats1} personer har 1 felles tema`);
      finalLogs.push(`📋 ${stats0} personer har 0 felles tema`);
      
      const endTime = performance.now();
      finalLogs.push(`⏱️ Total tid: ${((endTime - startTime) / 1000).toFixed(2)}s`);
      
      logs = [...logs, ...finalLogs];
      
      progress = `✅ Ferdig!`;
      await new Promise(resolve => setTimeout(resolve, 1500));
      isProcessing = false;
      
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'En ukjent feil oppstod';
      isProcessing = false;
      progress = '';
    }
  }
  
  async function loadExampleCSV() {
    try {
      const response = await fetch('/svar.csv');
      csvInput = await response.text();
    } catch (error) {
      errorMessage = 'Kunne ikke laste eksempel-CSV';
    }
  }
</script>

<main>
 
  <div class="layout">
    <aside class="sidebar">
      <section class="panel">
        <h2>1. CSV-data</h2>
        <textarea
          bind:value={csvInput}
          placeholder="Lim inn CSV-data her..."
          rows="6"
        ></textarea>
        <button class="secondary" onclick={loadExampleCSV}>Last eksempel</button>
      </section>
      
      <section class="panel">
        <h2>2. Bordkonfigurasjon</h2>
        <div class="tables-config">
          {#each tableSizes as _, i}
            <div class="table-config">
              <label>
                <span>Bord {i + 1}:</span>
                <input type="number" bind:value={tableSizes[i]} min="4" max="120" />
              </label>
              {#if tableSizes.length > 1}
                <button class="remove-btn" onclick={() => removeTable(i)}>×</button>
              {/if}
            </div>
          {/each}
          <button class="secondary small" onclick={addTable}>+ Legg til bord</button>
        </div>
        <div class="seat-summary">
          <div class="seat-summary-content">
            Totalt <strong>{totalSeats}</strong> plasser. {numberOfPeople} personer.
          </div>
          {#if numberOfPeople > totalSeats}
            <div class="error">
              ⚠️ For mange personer! Du har {numberOfPeople} personer, men bare {totalSeats} plasser. Legg til flere bord eller øk bordstørrelse.
            </div>
          {/if}
        </div>
      </section>
      
      <section class="panel">
        <h2>3. Algoritmevalg</h2>
        
        <label>
          <span>Avstandsmetode:</span>
          <select bind:value={distanceFunction}>
            <option value="commonality">Felleshet (anbefalt)</option>
            <option value="avg_distance">Gjennomsnittlig avstand</option>
          </select>
        </label>
        <p class="help-text">
          {#if distanceFunction === 'commonality'}
            Prioriterer personer med mange felles tema (opptil 4).
          {:else}
            Bruker Jaccard-avstand (union/snitt av tema).
          {/if}
        </p>
        
        <label>
          <span>Optimaliseringsmål:</span>
          <select bind:value={optimizationMode}>
            <option value="poor_connections">Minimér dårlige forbindelser</option>
            <option value="distance">Minimér total avstand</option>
          </select>
        </label>
        <p class="help-text">
          {#if optimizationMode === 'poor_connections'}
            Reduserer antall personer med 2 eller færre felles tema med naboer.
          {:else}
            Minimerer total avstand mellom alle naboer i rekkefølgen.
          {/if}
        </p>
        
        <label>
          <span>Antall simuleringer:</span>
          <input type="number" bind:value={attempts} min="10" max="1000" step="10" />
        </label>
      </section>
      
      <button 
        class="primary" 
        onclick={handleOptimize}
        disabled={isProcessing || !csvInput.trim()}
      >
        {isProcessing ? 'Prosesserer...' : '🚀 Optimaliser'}
      </button>
      
      {#if progress}
        <div class="progress">{progress}</div>
      {/if}
      
      {#if errorMessage}
        <div class="error">❌ {errorMessage}</div>
      {/if}
    </aside>
    
    <div class="main-content">
      {#if result && !isProcessing}
        <div class="results">
          <div class="stats-bar">
            <div class="stat-badge good">
              ✓ {result.statistics.filter(s => s.commonThemes.length > 2).length} med 3+ tema
            </div>
            <div class="stat-badge ok">
              ~ {result.statistics.filter(s => s.commonThemes.length === 2).length} med 2 tema
            </div>
            <div class="stat-badge warning" class:hidden={!result.statistics.some(s => s.commonThemes.length === 1)}>
              ⚠ {result.statistics.filter(s => s.commonThemes.length === 1).length} med 1 tema
            </div>
            <div class="stat-badge bad" class:hidden={!result.statistics.some(s => s.commonThemes.length === 0)}>
              ✗ {result.statistics.filter(s => s.commonThemes.length === 0).length} med 0 tema
            </div>
          </div>
          
          <div class="tables-container">
            {#each result.tables as table, tableIdx}
              {@const hasSeats = table.seats.some(s => s !== null)}
              {#if hasSeats}
                <TableVisual {table} tableNumber={tableIdx + 1} statistics={result.statistics} />
              {/if}
            {/each}
          </div>
        </div>
      {:else}
        <div class="placeholder">
          {#if logs.length > 0}
            <div class="logs-container">
              <h3>Prosess-logg:</h3>
              <div class="logs">
                {#each logs as log}
                  <div class="log-entry">{log}</div>
                {/each}
              </div>
            </div>
          {:else}
            <p>👈 Konfigurer innstillinger og klikk "Optimaliser" for å starte</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: #0f0f0f;
    color: #e0e0e0;
  }
  
  main {
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  
  .layout {
    width: 100%;
    display: grid;
    grid-template-columns: 350px 1fr;
    flex: 1;
    overflow: hidden;
  }
  
  .sidebar {
    background: #1a1a1a;
    padding: 1.5rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: 2px 0 4px rgba(0,0,0,0.5);
  }
  
  .main-content {
    overflow-y: auto;
    padding: 1.5rem;
    background: #0f0f0f;
  }
  
  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
  h2 {
    margin: 0;
    color: #b0b0b0;
    font-size: 1rem;
    font-weight: 600;
  }
  
  textarea {
    padding: 0.5rem;
    border: 2px solid #333;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    font-size: 0.85rem;
    resize: vertical;
    background: #252525;
    color: #e0e0e0;
  }
  
  textarea:focus {
    outline: none;
    border-color: #4CAF50;
  }
  
  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  
  label span {
    font-weight: 500;
    color: #999;
    font-size: 0.9rem;
  }
  
  input[type="number"],
  select {
    padding: 0.5rem;
    border: 2px solid #333;
    border-radius: 4px;
    font-size: 0.9rem;
    background: #252525;
    color: #e0e0e0;
  }
  
  input[type="number"]:focus,
  select:focus {
    outline: none;
    border-color: #4CAF50;
  }
  
  .seat-summary {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    text-align: center;
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
  }
  
  .tables-config {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .table-config {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }
  
  .table-config label {
    flex: 1;
  }
  
  .remove-btn {
    padding: 0.5rem 0.75rem;
    background: #c62828;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1.2rem;
    line-height: 1;
  }
  
  .remove-btn:hover {
    background: #d32f2f;
  }
  
  button {
    padding: 0.6rem 1rem;
    border: none;
    border-radius: 4px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  button.primary {
    background: #4CAF50;
    color: white;
    width: 100%;
    padding: 0.75rem;
    font-size: 1rem;
  }
  
  button.primary:hover:not(:disabled) {
    background: #45a049;
  }
  
  button.primary:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
  
  button.secondary {
    background: #2196F3;
    color: white;
  }
  
  button.secondary:hover {
    background: #0b7dda;
  }
  
  button.secondary.small {
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
  }
  
  .help-text {
    margin: -0.5rem 0 0 0;
    font-size: 0.8rem;
    color: #777;
    line-height: 1.3;
  }
  
  .progress {
    padding: 0.75rem;
    background: #1e3a5f;
    border-left: 4px solid #2196F3;
    border-radius: 4px;
    color: #64b5f6;
    font-size: 0.85rem;
  }
  
  .error {
    padding: 0.75rem;
    background: #3d1f1f;
    border-left: 4px solid #f44336;
    border-radius: 4px;
    color: #ef5350;
    font-size: 0.85rem;
  }
  
  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #555;
    font-size: 1.1rem;
  }
  
  .results {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .stats-bar {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    background: #1a1a1a;
    padding: 1rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
  }
  
  .stat-badge {
    padding: 0.5rem 1rem;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: 500;
  }
  
  .stat-badge.good {
    background: #1b5e20;
    color: #81c784;
  }
  
  .stat-badge.ok {
    background: #33691e;
    color: #aed581;
  }
  
  .stat-badge.warning {
    background: #e65100;
    color: #ffb74d;
  }
  
  .stat-badge.bad {
    background: #b71c1c;
    color: #ef5350;
  }
  
  .tables-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .logs-container {
    width: 100%;
    max-width: 800px;
  }
  
  .logs-container h3 {
    color: #b0b0b0;
    margin-bottom: 1rem;
  }
  
  .logs {
    background: #1a1a1a;
    border-radius: 8px;
    padding: 1rem;
    max-height: 500px;
    overflow-y: auto;
    font-family: 'Courier New', monospace;
    font-size: 0.85rem;
  }
  
  .log-entry {
    padding: 0.25rem 0;
    color: #d0d0d0;
    border-bottom: 1px solid #252525;
  }
  
  .log-entry:last-child {
    border-bottom: none;
  }

  .hidden {
    opacity: 0.25;
    pointer-events: none;
  }
</style>
