export interface Person {
  name: string;
  label?: string;
  themes: Set<string>;
}

export interface SeatingResult {
  order: number[];
  score: number;
  people: Person[];
}

export type DistanceFunction = "commonality" | "avg_distance";
export type OptimizationMode = "poor_connections" | "distance";

export interface Table {
  seats: (Person | null)[];
}

export interface TableAssignment {
  tables: Table[];
  statistics: SeatingStatistics[];
}

export interface SeatingStatistics {
  name: string;
  commonThemes: string[];
  combinedSimilarity: string;
  hasCommon: boolean;
  tableNumber: number;
  position: number;
}

const NAME_COL = "Navn";
const ATTENDING_COL = "Kommer du?";
const THEMES_COL = "Hva liker du vanligvis å snakke om med andre mennesker? (Svarene blir kun brukt for dette formålet, og slettet etterpå.)";

const CONSTANT_PAIRS_NAMES: [string, string][] = [
  ["Majbritt Jensen", "Boris Sidorevitj"],
  ["Ragnhild Ås Harbo", "Janne Rygh"],
];

// Helper function to parse a CSV line with proper quote handling
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim().replace(/^"|"$/g, ''));
  
  return fields;
}

// Helper function to derive name from email address
// function deriveNameFromEmail(email: string): string {
//   // Extract the part before @
//   const localPart = email.split('@')[0];
  
//   // Split by dots and process each part
//   const parts = localPart.split('.');
  
//   // Convert each part to title case, preserving hyphens
//   const nameParts = parts.map(part => {
//     // Handle hyphenated names like "ole-martin" or "amanda-k"
//     const hyphenParts = part.split('-');
//     const capitalizedHyphenParts = hyphenParts.map(hp => {
//       if (hp.length === 0) return hp;
//       // Single letter parts (like "k" in "amanda.k.jansen") stay lowercase
//       if (hp.length === 1) return hp.toLowerCase();
//       return hp.charAt(0).toUpperCase() + hp.slice(1).toLowerCase();
//     });
//     return capitalizedHyphenParts.join('-');
//   });
  
//   return nameParts.join(' ');
// }

// Parse CSV without external library
export function parseCSV(csvText: string): Person[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  
  // Parse headers with proper quote handling
  const headers = parseCSVLine(lines[0]);
  const nameIdx = headers.indexOf(NAME_COL);
  const attendingIdx = headers.indexOf(ATTENDING_COL);
  const themesIdx = headers.indexOf(THEMES_COL);
  
  if (nameIdx === -1 || attendingIdx === -1 || themesIdx === -1) {
    throw new Error(`Mangler påkrevde kolonner. Forventet: "${NAME_COL}", "${ATTENDING_COL}", "${THEMES_COL}"`);
  }
  
  const people: Person[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    // Parse line with proper quote handling
    const fields = parseCSVLine(line);
    
    if (fields[attendingIdx] === 'Ja') {
      const themesText = fields[themesIdx] || '';
      const themes = new Set(
        themesText.split(',').map(t => t.trim()).filter(t => t)
      );
      
      // // Derive name from email address
      // const email = fields[nameIdx];
      // const name = deriveNameFromEmail(email);

      people.push({
        name: fields[nameIdx],
        themes
      });
    }
  }
  
  return people;
}

// Distance functions
function commonalityDistance(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter(x => b.has(x)).length;
  const commonCount = Math.min(inter, 4);
  return (4 - commonCount) / 4; // 0 = closest (4+ common), 1 = farthest (0 common)
}

function avgDistance(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 1;
  return 1 - (inter / union);
}

function getDistanceFunction(type: DistanceFunction): (a: Set<string>, b: Set<string>) => number {
  return type === "commonality" ? commonalityDistance : avgDistance;
}

// Check if two people have common themes
function hasCommonThemes(personA: Person, personB: Person): boolean {
  return [...personA.themes].some(t => personB.themes.has(t));
}

// Find constant pairs by name and return their indices
function findConstantPairs(people: Person[]): Map<number, number> {
  const pairMap = new Map<number, number>(); // Maps person index to their pair's index
  
  for (const [name1, name2] of CONSTANT_PAIRS_NAMES) {
    const idx1 = people.findIndex(p => p.name === name1);
    const idx2 = people.findIndex(p => p.name === name2);
    
    if (idx1 !== -1 && idx2 !== -1) {
      pairMap.set(idx1, idx2);
      pairMap.set(idx2, idx1);
    }
  }
  
  return pairMap;
}

// Create distance matrix
function createDistanceMatrix(
  people: Person[], 
  distanceFunc: (a: Set<string>, b: Set<string>) => number,
  constantPairs: Map<number, number>
): number[][] {
  const n = people.length;
  const distMatrix = Array.from({ length: n }, () => Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // If they are a constant pair, set distance to 0 (must sit together)
      if (constantPairs.get(i) === j) {
        distMatrix[i][j] = distMatrix[j][i] = 0;
      } else {
        const d = distanceFunc(people[i].themes, people[j].themes);
        distMatrix[i][j] = distMatrix[j][i] = d;
      }
    }
  }
  
  return distMatrix;
}

// Nearest-neighbor TSP heuristic with common themes
function nearestNeighborWithCommonThemes(
  distMatrix: number[][],
  people: Person[],
  constantPairs: Map<number, number>,
  startIdx: number = 0
): number[] {
  const n = distMatrix.length;
  const route: number[] = [];
  const visited = new Set<number>();
  
  let current = startIdx;
  route.push(current);
  visited.add(current);

  while (route.length < n) {
    let next = -1;
    let bestDist = Infinity;
    
    // Priority 1: If current person has a constant pair that's not visited, place them next
    const pairIdx = constantPairs.get(current);
    if (pairIdx !== undefined && !visited.has(pairIdx)) {
      next = pairIdx;
      bestDist = 0;
    } else {
      // Priority 2: try to find someone with common themes
      for (let j = 0; j < n; j++) {
        if (!visited.has(j) && 
            hasCommonThemes(people[current], people[j]) &&
            distMatrix[current][j] < bestDist) {
          bestDist = distMatrix[current][j];
          next = j;
        }
      }
      
      // Priority 3: If no one with common themes, take the nearest
      if (next === -1) {
        for (let j = 0; j < n; j++) {
          if (!visited.has(j) && distMatrix[current][j] < bestDist) {
            bestDist = distMatrix[current][j];
            next = j;
          }
        }
      }
    }
    
    if (next === -1) {
      // Fallback: pick any unvisited person
      for (let j = 0; j < n; j++) {
        if (!visited.has(j)) {
          next = j;
          break;
        }
      }
    }
    
    if (next === -1) break; // Should not happen
    
    route.push(next);
    visited.add(next);
    current = next;
  }

  return route;
}

// Check if a swap would break a constant pair
function wouldBreakConstantPair(
  route: number[],
  i: number,
  j: number,
  constantPairs: Map<number, number>
): boolean {
  if (constantPairs.size === 0) return false;
  
  const n = route.length;
  
  // Check all constant pairs
  for (const [idx1, idx2] of constantPairs.entries()) {
    const pos1 = route.indexOf(idx1);
    const pos2 = route.indexOf(idx2);
    
    if (pos1 === -1 || pos2 === -1) continue;
    
    // Check if they are neighbors
    const areNeighbors =
      Math.abs(pos1 - pos2) === 1 ||
      (pos1 === 0 && pos2 === n - 1) ||
      (pos2 === 0 && pos1 === n - 1);
    
    if (areNeighbors) {
      // Check if swap would break this pair
      const pos1InSegment = pos1 >= i && pos1 <= j;
      const pos2InSegment = pos2 >= i && pos2 <= j;
      
      // If only one is in segment, it breaks the pair
      if (pos1InSegment !== pos2InSegment) {
        return true;
      }
      
      // If both are in segment, check if they'll still be neighbors after reversal
      if (pos1InSegment && pos2InSegment) {
        const newPos1 = j - (pos1 - i);
        const newPos2 = j - (pos2 - i);
        const stillNeighbors =
          Math.abs(newPos1 - newPos2) === 1 ||
          (newPos1 === 0 && newPos2 === n - 1) ||
          (newPos2 === 0 && newPos1 === n - 1);
        if (!stillNeighbors) {
          return true;
        }
      }
    }
  }
  
  return false;
}

// 2-opt optimization algorithm
function twoOpt(
  route: number[], 
  distMatrix: number[][], 
  people: Person[],
  constantPairs: Map<number, number>
): number[] {
  let improved = true;
  const n = route.length;
  
  while (improved) {
    improved = false;
    
    for (let i = 1; i < n - 2; i++) {
      for (let j = i + 1; j < n - 1; j++) {
        // Don't perform swap if it would break a constant pair
        if (wouldBreakConstantPair(route, i, j, constantPairs)) {
          continue;
        }
        
        const before = distMatrix[route[i-1]][route[i]] + distMatrix[route[j]][route[j+1]];
        const after = distMatrix[route[i-1]][route[j]] + distMatrix[route[i]][route[j+1]];
        
        if (after < before) {
          let isolationPenalty = 0;
          if (!hasCommonThemes(people[route[i-1]], people[route[j]])) {
            isolationPenalty += 0.5;
          }
          if (!hasCommonThemes(people[route[i]], people[route[j+1]])) {
            isolationPenalty += 0.5;
          }

          if (after + isolationPenalty < before) {
            const segment = route.slice(i, j + 1).reverse();
            route.splice(i, j - i + 1, ...segment);
            improved = true;
            break;
          }
        }
      }
      if (improved) break;
    }
  }
  
  return route;
}

// Ensure constant pairs are neighbors in the route
function enforceConstantPairs(route: number[], constantPairs: Map<number, number>): number[] {
  if (constantPairs.size === 0) return route;
  
  const newRoute = [...route];
  const n = newRoute.length;
  
  for (const [idx1, idx2] of constantPairs.entries()) {
    const pos1 = newRoute.indexOf(idx1);
    const pos2 = newRoute.indexOf(idx2);
    
    if (pos1 === -1 || pos2 === -1) continue;
    
    // Check if they are already neighbors
    const areNeighbors =
      Math.abs(pos1 - pos2) === 1 ||
      (pos1 === 0 && pos2 === n - 1) ||
      (pos2 === 0 && pos1 === n - 1);
    
    if (!areNeighbors) {
      // Move them to be neighbors
      // Strategy: move the second person to be right after the first
      if (pos1 < pos2) {
        // Remove idx2 and insert it after idx1
        newRoute.splice(pos2, 1);
        const newPos1 = newRoute.indexOf(idx1);
        newRoute.splice(newPos1 + 1, 0, idx2);
      } else {
        // Remove idx1 and insert it after idx2
        newRoute.splice(pos1, 1);
        const newPos2 = newRoute.indexOf(idx2);
        newRoute.splice(newPos2 + 1, 0, idx1);
      }
    }
  }
  
  return newRoute;
}

// Count people with poor connections (≤2 common themes with neighbors)
function countPoorConnections(route: number[], people: Person[]): number {
  let poorCount = 0;
  
  for (let i = 0; i < route.length; i++) {
    const person = people[route[i]];
    let totalCommonThemes = new Set<string>();
    
    if (i > 0) {
      const prev = people[route[i - 1]];
      [...person.themes].forEach(t => {
        if (prev.themes.has(t)) totalCommonThemes.add(t);
      });
    }
    
    if (i < route.length - 1) {
      const next = people[route[i + 1]];
      [...person.themes].forEach(t => {
        if (next.themes.has(t)) totalCommonThemes.add(t);
      });
    }
    
    if (totalCommonThemes.size <= 2) {
      poorCount++;
    }
  }
  
  return poorCount;
}

// Calculate total cost (sum of distances)
function calculateTotalCost(route: number[], distMatrix: number[][]): number {
  let cost = 0;
  for (let i = 0; i < route.length - 1; i++) {
    cost += distMatrix[route[i]][route[i + 1]];
  }
  return cost;
}

// Main optimization function
export function optimizeSeating(
  people: Person[],
  attempts: number = 100,
  distanceFunction: DistanceFunction = "commonality",
  optimizationMode: OptimizationMode = "poor_connections",
  onProgress?: (attempt: number, score: number) => void
): SeatingResult {
  const n = people.length;
  const distFunc = getDistanceFunction(distanceFunction);
  const constantPairs = findConstantPairs(people);
  const distMatrix = createDistanceMatrix(people, distFunc, constantPairs);
  
  let bestOverallOrder: number[] | null = null;
  let bestOverallScore = Infinity;
  
  for (let attempt = 0; attempt < attempts; attempt++) {
    const startIdx = Math.floor(Math.random() * n);
    let order = nearestNeighborWithCommonThemes(distMatrix, people, constantPairs, startIdx);
    order = twoOpt(order, distMatrix, people, constantPairs);
    order = enforceConstantPairs(order, constantPairs);
    
    const score = optimizationMode === "distance" 
      ? calculateTotalCost(order, distMatrix)
      : countPoorConnections(order, people);
    
    if (score < bestOverallScore) {
      bestOverallScore = score;
      bestOverallOrder = order;
      
      if (onProgress) {
        onProgress(attempt + 1, score);
      }
    }
  }
  
  // Final enforcement to ensure pairs are together
  if (bestOverallOrder) {
    bestOverallOrder = enforceConstantPairs(bestOverallOrder, constantPairs);
  }
  
  return {
    order: bestOverallOrder!,
    score: bestOverallScore,
    people
  };
}

// Assign people to tables in a snake pattern with variable table sizes
export function assignToTables(
  seatingResult: SeatingResult,
  tableSizes: number[]
): TableAssignment {
  const { order, people } = seatingResult;
  const constantPairs = findConstantPairs(people);
  const tables: Table[] = tableSizes.map(() => ({ seats: [] }));
  
  let personIdx = 0;
  
  for (let tableIdx = 0; tableIdx < tableSizes.length; tableIdx++) {
    const seatsPerTable = tableSizes[tableIdx];
    const seatsPerSide = Math.ceil(seatsPerTable / 2);
    
    const leftSeats: (Person | null)[] = [];
    const rightSeats: (Person | null)[] = [];
    
    // Fill left side
    for (let i = 0; i < seatsPerSide && personIdx < order.length; i++) {
      leftSeats.push(people[order[personIdx++]]);
    }
    
    // Fill right side
    for (let i = 0; i < seatsPerSide && personIdx < order.length; i++) {
      rightSeats.push(people[order[personIdx++]]);
    }
    
    // Merge left and right sides in snake pattern
    // Right side should be reversed so the snake continues
    const tableSeats = [...leftSeats, ...rightSeats.reverse()];
    tables[tableIdx].seats = tableSeats;
  }
  
  // CRITICAL: Ensure constant pairs sit together on tables
  enforceConstantPairsOnTables(tables, constantPairs, people);
  
  // Validate that constant pairs are actually together
  validateConstantPairs(tables);
  
  // Calculate statistics
  const statistics = calculateStatistics(tables);
  
  return { tables, statistics };
}

// Validate that constant pairs are sitting together (for debugging)
function validateConstantPairs(tables: Table[]): void {
  for (const [name1, name2] of CONSTANT_PAIRS_NAMES) {
    let table1Idx = -1, seat1Idx = -1;
    let table2Idx = -1, seat2Idx = -1;
    
    for (let t = 0; t < tables.length; t++) {
      for (let s = 0; s < tables[t].seats.length; s++) {
        const person = tables[t].seats[s];
        if (person && person.name === name1) {
          table1Idx = t;
          seat1Idx = s;
        }
        if (person && person.name === name2) {
          table2Idx = t;
          seat2Idx = s;
        }
      }
    }
    
    if (table1Idx === -1 || table2Idx === -1) {
      console.warn(`⚠️ Constant pair not found: ${name1} and ${name2}`);
      continue;
    }
    
    if (table1Idx !== table2Idx) {
      console.error(`❌ ERROR: Constant pair on different tables! ${name1} (table ${table1Idx + 1}) and ${name2} (table ${table2Idx + 1})`);
      continue;
    }
    
    const table = tables[table1Idx];
    const n = table.seats.length;
    const areAdjacent = 
      Math.abs(seat1Idx - seat2Idx) === 1 ||
      (seat1Idx === 0 && seat2Idx === n - 1) ||
      (seat2Idx === 0 && seat1Idx === n - 1);
    
    if (!areAdjacent) {
      console.error(`❌ ERROR: Constant pair not adjacent! ${name1} (seat ${seat1Idx + 1}) and ${name2} (seat ${seat2Idx + 1}) on table ${table1Idx + 1}`);
    } else {
      console.log(`✅ Constant pair together: ${name1} and ${name2} on table ${table1Idx + 1}`);
    }
  }
}

// Ensure constant pairs are sitting next to each other on tables
function enforceConstantPairsOnTables(
  tables: Table[],
  constantPairs: Map<number, number>,
  people: Person[]
): void {
  if (constantPairs.size === 0) return;
  
  // Create a map: person name -> person object
  const nameToPerson = new Map<string, Person>();
  people.forEach((p) => nameToPerson.set(p.name, p));
  
  // For each constant pair, ensure they sit together
  for (const [name1, name2] of CONSTANT_PAIRS_NAMES) {
    const person1 = nameToPerson.get(name1);
    const person2 = nameToPerson.get(name2);
    
    if (!person1 || !person2) continue;
    
    // Find which table and position each person is at
    let table1Idx = -1, seat1Idx = -1;
    let table2Idx = -1, seat2Idx = -1;
    
    for (let t = 0; t < tables.length; t++) {
      for (let s = 0; s < tables[t].seats.length; s++) {
        const person = tables[t].seats[s];
        if (person && person.name === name1) {
          table1Idx = t;
          seat1Idx = s;
        }
        if (person && person.name === name2) {
          table2Idx = t;
          seat2Idx = s;
        }
      }
    }
    
    // If not found, skip
    if (table1Idx === -1 || table2Idx === -1) continue;
    
    const table1 = tables[table1Idx];
    const table2 = tables[table2Idx];
    
    // If they're on different tables, move person2 to table1
    if (table1Idx !== table2Idx) {
      // Remove person2 from table2
      table2.seats[seat2Idx] = null;
      
      // Find a spot next to person1 in table1
      const adjacentSeat = findAdjacentSeat(table1, seat1Idx);
      if (adjacentSeat !== -1) {
        table1.seats[adjacentSeat] = person2;
        seat2Idx = adjacentSeat;
        table2Idx = table1Idx;
      } else {
        // No adjacent seat available, insert right after person1
        const insertPos = seat1Idx + 1;
        table1.seats.splice(insertPos, 0, person2);
        seat2Idx = insertPos;
        table2Idx = table1Idx;
        // Remove null from table2 if any
        const nullIdx = table2.seats.indexOf(null);
        if (nullIdx !== -1) {
          table2.seats.splice(nullIdx, 1);
        }
      }
    }
    
    // Now ensure they're adjacent on the same table
    const table = tables[table1Idx];
    const n = table.seats.length;
    const areAdjacent = 
      Math.abs(seat1Idx - seat2Idx) === 1 ||
      (seat1Idx === 0 && seat2Idx === n - 1) ||
      (seat2Idx === 0 && seat1Idx === n - 1);
    
    if (!areAdjacent) {
      // Remove person2 from current position
      table.seats[seat2Idx] = null;
      
      // Find or create adjacent seat to person1
      const adjacentSeat = findAdjacentSeat(table, seat1Idx);
      if (adjacentSeat !== -1) {
        table.seats[adjacentSeat] = person2;
      } else {
        // Insert right after person1
        const insertPos = seat1Idx + 1;
        table.seats.splice(insertPos, 0, person2);
        // Remove the null we created
        const nullIdx = table.seats.indexOf(null);
        if (nullIdx !== -1) {
          table.seats.splice(nullIdx, 1);
        }
      }
    }
  }
  
  // Clean up any trailing nulls
  for (const table of tables) {
    while (table.seats.length > 0 && table.seats[table.seats.length - 1] === null) {
      table.seats.pop();
    }
  }
}

// Find an adjacent empty seat, or return -1
function findAdjacentSeat(table: Table, seatIdx: number): number {
  const n = table.seats.length;
  if (n === 0) return -1;
  
  // Check seat before (circular)
  const prevIdx = seatIdx > 0 ? seatIdx - 1 : n - 1;
  if (table.seats[prevIdx] === null) {
    return prevIdx;
  }
  
  // Check seat after (circular)
  const nextIdx = seatIdx < n - 1 ? seatIdx + 1 : 0;
  if (table.seats[nextIdx] === null) {
    return nextIdx;
  }
  
  return -1;
}

function calculateStatistics(tables: Table[]): SeatingStatistics[] {
  const stats: SeatingStatistics[] = [];
  
  tables.forEach((table, tableIdx) => {
    table.seats.forEach((person, seatIdx) => {
      if (!person) return;
      
      let previousThemes: string[] = [];
      let nextThemes: string[] = [];
      let previousSimilarity = 0;
      let nextSimilarity = 0;
      
      if (seatIdx > 0 && table.seats[seatIdx - 1]) {
        const prev = table.seats[seatIdx - 1]!;
        previousThemes = [...person.themes].filter(t => prev.themes.has(t));
        previousSimilarity = commonalityDistance(person.themes, prev.themes);
      }
      
      if (seatIdx < table.seats.length - 1 && table.seats[seatIdx + 1]) {
        const next = table.seats[seatIdx + 1]!;
        nextThemes = [...person.themes].filter(t => next.themes.has(t));
        nextSimilarity = commonalityDistance(person.themes, next.themes);
      }
      
      const commonThemes = new Set([...previousThemes, ...nextThemes]);
      const combinedSimilarity = seatIdx === 0 
        ? nextSimilarity 
        : seatIdx === table.seats.length - 1 
        ? previousSimilarity 
        : (previousSimilarity + nextSimilarity) / 2;
      
      stats.push({
        name: person.name,
        commonThemes: [...commonThemes],
        combinedSimilarity: combinedSimilarity.toFixed(2),
        hasCommon: commonThemes.size > 0,
        tableNumber: tableIdx + 1,
        position: seatIdx + 1
      });
    });
  });
  
  return stats;
}
