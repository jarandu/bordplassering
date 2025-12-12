<script lang="ts">
  import type { Table, Person } from './lib/seating';
  
  interface Props {
    tables: Table[];
  }
  
  const { tables }: Props = $props();
  
  const cardsPerRow = 3;
  const cardsPerColumn = 2;
  const cardsPerPage = cardsPerRow * cardsPerColumn;
  
  // Organize all place cards by table and position
  interface PlaceCard {
    person: Person;
    tableNumber: number;
    position: number; // 1-indexed position at the table
  }
  
  const allCards: PlaceCard[] = [];
  
  tables.forEach((table, tableIdx) => {
    table.seats.forEach((person, seatIdx) => {
      if (person !== null) {
        allCards.push({
          person,
          tableNumber: tableIdx + 1,
          position: seatIdx + 1
        });
      }
    });
  });
  
  // Sort by table number, then by position
  allCards.sort((a, b) => {
    if (a.tableNumber !== b.tableNumber) {
      return a.tableNumber - b.tableNumber;
    }
    return a.position - b.position;
  });
  
  // Group cards into pages (A4 sheets)
  const pages: PlaceCard[][] = [];
  for (let i = 0; i < allCards.length; i += cardsPerPage) {
    pages.push(allCards.slice(i, i + cardsPerPage));
  }
</script>

<div class="place-cards-container">
  {#each pages as page, pageIdx}
    <div class="a4-page">
      <div class="page-inner">
        <div class="x-grid grid">
          <div></div>
          <div></div>
          <div></div>
          <div></div>
        </div>
        <div class="y-grid grid">
          <div></div>
          <div></div>
          <div></div>
        </div>
        <div class="cards-container">
          {#each page as card, i}
            <div class="card">
              <div class="card-back">
                <img src="/nisse-reverse.svg" alt="Nisse" />
              </div>
              <div class="card-front">
                <div class="card-name">{card.person.name}</div>
                {#if card.person.label}
                  <div class="card-label">{card.person.label}</div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/each}
</div>

<style>
  .place-cards-container {
    --page-width: 29.7cm;
    --page-height: 21cm;
    --page-padding: 0.2cm;
    --page-margin: 0.4cm;
    --purple-light: #eee2ff;
    --purple-dark: #5400C2;

    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: #0f0f0f;
  }
  
  .a4-page {
    width: var(--page-width);
    height: var(--page-height);
    padding: var(--page-margin);
    background: white;
    box-sizing: border-box;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    margin: 0 auto;
  }
  
  .page-inner {
    position: relative;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: var(--page-padding);
  }
  
  .cards-container {
    position: relative;
    z-index: 100;
    height: 100%;
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
    page-break-after: always;
    place-items: center;
    background: var(--purple-light);
    box-sizing: border-box;
  }

  .grid {
    position: absolute;
    top: 0;
    left: calc(var(--page-padding) + 1px);
    width: calc(100% - var(--page-padding) * 2 - 2px);
    height: 100%;
    display: flex;
    justify-content: space-between;
  }
  
  .y-grid {
    flex-direction: column;
    top: calc(var(--page-padding) + 1px);
    left: 0;
    height: calc(100% - var(--page-padding) * 2 - 2px);
    width: 100%;
  }

  .grid div {
    width: 100%;
    height: 100%;
    background: #333;
    width: 1px;
    height: 100%;
  }

  .y-grid div {
    width: 100%;
    height: 1px;
  }
  
  .card {
    height: 100%;
    width: 100%;
    box-sizing: border-box;
    background: var(--card-background);
    overflow: hidden;
  }

  .card:nth-child(1),
  .card:nth-child(2),
  .card:nth-child(3) {
    transform: rotate(180deg);
  }
  
  .card-back {
    position: relative;
    width: 100%;
    height: 50%;

    img {
      position: absolute;
      top: -25%;
      right: 33.2%;
      width: 150pt;
      height: auto;
    }
  }
  
  .card-front {
    text-align: center;
    width: 100%;
    height: 50%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }
  
  .card-name {
    font-size: 23pt;
    font-weight: bold;
    color: var(--purple-dark);
    line-height: 1.3;
    margin-inline: 1em;
    font-family: 'Sigmar', cursive;
  }
  
  .card-label {
    font-size: 16pt;
    font-weight: 500;
    margin-top: 0.3cm;
    color: var(--purple-dark);
    opacity: 0.6;
  }
  
  /* Print styles */
  @media print {
    /* Force colors to print */
    * {
      print-color-adjust: exact !important;
      -webkit-print-color-adjust: exact !important;
    }
    
    .place-cards-container {
      padding: 0;
      background: white;
    }
    
    .a4-page {
      margin: 0;
      box-shadow: none;
      page-break-after: always;
      page-break-inside: avoid;
    }
    
    /* Ensure colors are preserved */
    .cards-container {
      background: var(--purple-light) !important;
      print-color-adjust: exact !important;
      -webkit-print-color-adjust: exact !important;
    }
    
    .card-name,
    .card-label {
      color: var(--purple-dark) !important;
      print-color-adjust: exact !important;
      -webkit-print-color-adjust: exact !important;
    }
    
    /* Ensure overflow works correctly */
    .card {
      overflow: hidden !important;
    }
    
    .card-back,
    .card-front,
    .cards-container,
    .page-inner {
      overflow: visible !important;
    }
    
    /* Ensure images are visible */
    .card-back img {
      visibility: visible !important;
      display: block !important;
    }
  }
</style>

