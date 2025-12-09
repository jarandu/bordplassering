<script lang="ts">
  import type { Table, Person } from './seating';
  
  interface Props {
    table: Table;
    tableNumber: number;
    statistics: any[];
  }
  
  const { table, tableNumber, statistics }: Props = $props();
  
  const seatSize = 23;
  const seatGap = 4;
  const padding = 5;
  
  // Calculate dimensions based on seats
  const seatsPerSide = Math.ceil(table.seats.length / 2);
  const tableWidth = seatsPerSide * (seatSize + seatGap) - seatGap;
  const width = tableWidth + padding * 2;
  const tableHeight = 20;
  const height = tableHeight + seatSize * 2 + padding * 2;
  
  // Create a lookup map for O(1) access instead of O(n) find()
  const statsMap = new Map(
    statistics
      .filter(s => s.tableNumber === tableNumber)
      .map(s => [s.name, s])
  );
  
  function getInitials(name: string): string {
    const parts = name.split(/[@\s.]+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
  
  function getSeatColor(commonThemesCount: number): string {
    if (commonThemesCount > 2) return '#4CAF50';
    if (commonThemesCount === 2) return '#d3bb06';
    if (commonThemesCount === 1) return '#FF9800';
    return '#f44336';
  }
  
  function getSharedThemes(person: Person | null, next: Person | null, prev: Person | null): string {
    const shared = new Set<string>();
    // Add themes that are shared between personA and personB
    if (person && next) {
    person.themes.forEach(t => {
        if (next.themes.has(t)) {
          shared.add(t);
        }
      });
    }
    // Add themes that are shared between personA and personC
    if (person && prev) {
      person.themes.forEach(t => {
      if (prev.themes.has(t)) {
        shared.add(t);
      }
      });
    }
    return Array.from(shared).map(t => Array.from(t)[0]).join(' ');
  }
  
  // Pre-calculate all seat data once
  interface SeatData {
    x: number;
    y: number;
    person: Person | null;
    initials: string;
    color: string;
    commonThemesCount: number;
    position: number;
  }
  
  const seatData: SeatData[] = [];
  
  // Snake pattern: 
  // Person 0: top-left
  // Person 1: bottom-left
  // Person 2: bottom, one step right
  // Person 3: top, one step right
  // Person 4: top, one more step right
  // Person 5: bottom, one more step right
  // etc.
  
  let xPos = 0; // Current x position (in seat units, not pixels)
  let onTop = true; // Start on top
  
  table.seats.forEach((person, i) => {
    if (!person) return;
    
    const stat = statsMap.get(person.name);
    const commonThemesCount = stat?.commonThemes.length || 0;
    
    // Calculate pixel position
    const x = padding + xPos * (seatSize + seatGap) + seatSize / 2;
    const y = onTop ? padding : padding + tableHeight + seatSize;
    
    seatData.push({
      x,
      y,
      person,
      initials: getInitials(person.name),
      color: getSeatColor(commonThemesCount),
      commonThemesCount,
      position: i
    });
    
    // Move to next position in snake pattern
    if (i === 0) {
      // After first person (top-left), go to bottom-left
      onTop = false;
    } else if (!onTop) {
      // If we're on bottom, move right and go to top
      xPos++;
      onTop = true;
    } else {
      // If we're on top, stay at same x and go to bottom
      onTop = false;
    }
  });
</script>

<div class="table-visual">
  <h3>Bord {tableNumber}</h3>
  <div class="svg-wrapper">
    <svg {width} {height} viewBox="0 0 {width} {height}">
    <!-- Table rectangle (horizontal) -->
    <rect 
      x={padding} 
      y={padding + seatSize} 
      width={tableWidth} 
      height={tableHeight}
      fill="#5d4037"
      stroke="#3e2723"
      stroke-width="1"
      rx="4"
    />
    
    <!-- Seats -->
    {#each seatData as seat}
      <g class="seat-group">
        <circle 
          cx={seat.x} 
          cy={seat.y + seatSize / 2} 
          r={seatSize / 2}
          fill={seat.color}
          stroke="#1a1a1a"
          stroke-width="2"
        />
        <text 
          x={seat.x} 
          y={seat.y + seatSize / 2} 
          text-anchor="middle"
          dominant-baseline="middle"
          class="seat-initials"
        >
          {seat.initials}
        </text>
        <title>{seat.person?.name} - {seat.commonThemesCount} felles tema</title>
      </g>
    {/each}
    </svg>
  </div>
  
  <div class="seat-list">
    {#each seatData as seat, idx}
      {@const nextPerson = idx < table.seats.length - 1 ? table.seats[seat.position + 1] : null}
      {@const prevPerson = idx > 0 ? table.seats[seat.position - 1] : null}
      {@const shared = getSharedThemes(seat.person, nextPerson, prevPerson)}
      
      <div class="seat-info" style="border-left-color: {seat.color}">
        <div class="seat-header">
          <span class="seat-num">{seat.position + 1}.</span>
          <span class="person-name">{seat.person?.name} [{seat.person?.label}]</span>
          <span class="theme-count">({seat.commonThemesCount} tema)</span>
        </div>
        {#if shared.length > 0}
          <div class="shared-themes">
            <span class="shared-items">{shared}</span>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .table-visual {
    background: #1a1a1a;
    border-radius: 8px;
    padding: 1rem;
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
  }
  
  h3 {
    margin: 0 0 0.5rem 0;
    color: #b0b0b0;
    font-size: 1rem;
  }
  
  .svg-wrapper {
    overflow-x: auto;
    overflow-y: hidden;
    margin-bottom: 0.75rem;
  }
  
  svg {
    display: block;
    min-width: 100%;
  }
  
  .seat-initials {
    fill: white;
    font-size: 11px;
    font-weight: bold;
    pointer-events: none;
  }
  
  .seat-list {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 300px;
    overflow-y: auto;
  }
  
  .seat-info {
    display: flex;
    justify-content: space-between;
    gap: 0.25rem;
    padding: 0.5rem;
    font-size: 0.85rem;
    background: #252525;
    border-radius: 4px;
  }
  
  .seat-header {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  
  .seat-num {
    font-weight: bold;
    color: #888;
    min-width: 1.5rem;
  }
  
  .person-name {
    flex: 1;
    color: #d0d0d0;
    font-weight: 500;
  }
  
  .theme-count {
    color: #777;
    font-size: 0.8rem;
  }
  
  .shared-themes {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin-left: 2rem;
    font-size: 0.75rem;
  }
  
  .shared-items {
    color: #aaa;
    flex: 1;
    font-size: 1.25rem;
  }
</style>
