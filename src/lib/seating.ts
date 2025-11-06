export interface Person {
  name: string;
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

const NAME_COL = "E-postadresse";
const ATTENDING_COL = "Kommer du?";
const THEMES_COL = "Hva liker du vanligvis å snakke om med andre mennesker? (Svarene blir kun brukt for dette formålet, og slettet etterpå.)";

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

// Create distance matrix
function createDistanceMatrix(people: Person[], distanceFunc: (a: Set<string>, b: Set<string>) => number): number[][] {
  const n = people.length;
  const distMatrix = Array.from({ length: n }, () => Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distanceFunc(people[i].themes, people[j].themes);
      distMatrix[i][j] = distMatrix[j][i] = d;
    }
  }
  
  return distMatrix;
}

// Nearest-neighbor TSP heuristic with common themes
function nearestNeighborWithCommonThemes(
  distMatrix: number[][],
  people: Person[],
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
    
    // First: try to find someone with common themes
    for (let j = 0; j < n; j++) {
      if (!visited.has(j) && 
          hasCommonThemes(people[current], people[j]) &&
          distMatrix[current][j] < bestDist) {
        bestDist = distMatrix[current][j];
        next = j;
      }
    }
    
    // If no one with common themes, take the nearest
    if (next === -1) {
      for (let j = 0; j < n; j++) {
        if (!visited.has(j) && distMatrix[current][j] < bestDist) {
          bestDist = distMatrix[current][j];
          next = j;
        }
      }
    }
    
    route.push(next);
    visited.add(next);
    current = next;
  }

  return route;
}

// 2-opt optimization algorithm
function twoOpt(route: number[], distMatrix: number[][], people: Person[]): number[] {
  let improved = true;
  const n = route.length;
  
  while (improved) {
    improved = false;
    
    for (let i = 1; i < n - 2; i++) {
      for (let j = i + 1; j < n - 1; j++) {
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
  const distMatrix = createDistanceMatrix(people, distFunc);
  
  let bestOverallOrder: number[] | null = null;
  let bestOverallScore = Infinity;
  
  for (let attempt = 0; attempt < attempts; attempt++) {
    const startIdx = Math.floor(Math.random() * n);
    let order = nearestNeighborWithCommonThemes(distMatrix, people, startIdx);
    order = twoOpt(order, distMatrix, people);
    
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
  
  // Calculate statistics
  const statistics = calculateStatistics(tables);
  
  return { tables, statistics };
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
