<script lang="ts">
  import type { Table, Person } from './seating';
  
  interface Props {
    tables: Table[];
  }
  
  const { tables }: Props = $props();
  
  // Create alphabetical list of all people from all tables
  const allPeople = tables
    .flatMap((table, tableIdx) => 
      table.seats
        .filter((person): person is Person => person !== null)
        .map(person => ({ person, tableNumber: tableIdx + 1 }))
    )
    .sort((a, b) => a.person.name.localeCompare(b.person.name, 'no', { sensitivity: 'base' }));
</script>

<div class="alphabetical-list-container">
  {#each allPeople as { person, tableNumber }}
    <div class="alphabetical-item">
      <span class="person-name">{person.name}</span>
      <span class="table-number">Bord {tableNumber}</span>
    </div>
  {/each}
</div>

<style>
  .alphabetical-list-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: calc(100vh - 250px);
    overflow-y: auto;
    background: #1a1a1a;
    border-radius: 8px;
    padding: 1rem;
  }
  
  .alphabetical-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    background: #252525;
    border-radius: 4px;
    font-size: 0.9rem;
  }
  
  .alphabetical-item .person-name {
    color: #d0d0d0;
    font-weight: 500;
    flex: 1;
  }
  
  .alphabetical-item .table-number {
    color: #888;
    font-size: 0.85rem;
  }
</style>

