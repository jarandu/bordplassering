import fs from "fs";
import Papa from "papaparse";

const NAME_COL = "E-postadresse";
const ATTENDING_COL = "Kommer du?";
const THEMES_COL = "Hva liker du vanligvis å snakke om med andre mennesker? (Svarene blir kun brukt for dette formålet, og slettet etterpå.)";

// --- 1. Les CSV med feilhåndtering ---
let csv;
try {
  csv = fs.readFileSync("svar.csv", "utf8");
} catch (error) {
  console.error("Kunne ikke lese svar.csv:", error.message);
  process.exit(1);
}

const rows = Papa.parse(csv, { header: true }).data.filter(r => r[ATTENDING_COL] === "Ja");

if (rows.length === 0) {
  console.error("Ingen gyldige rader funnet i CSV-filen");
  process.exit(1);
}

const people = rows.map((row) => ({
  name: row[NAME_COL],
  themes: new Set(row[THEMES_COL].split(",").map(t => t.trim()))
}));

const n = people.length;

// --- 2. Lag avstandsmatrise ---
function distance(a, b) {
  const inter = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 1;
  return 1 - (inter / union);
}

const distMatrix = Array.from({ length: n }, () => Array(n).fill(0));
for (let i = 0; i < n; i++) {
  for (let j = i + 1; j < n; j++) {
    const d = distance(people[i].themes, people[j].themes);
    distMatrix[i][j] = distMatrix[j][i] = d;
  }
}

// --- 3. Hjelpefunksjon: Har to personer felles tema? ---
function hasCommonThemes(personA, personB) {
  return [...personA.themes].some(t => personB.themes.has(t));
}

// --- 4. Nearest-neighbor TSP heuristic med felles tema ---
function nearestNeighborWithCommonThemes(distMatrix, people, startIdx = 0) {
  const n = distMatrix.length;
  const tempRoute = [];
  const tempVisited = new Set();
  
  let current = startIdx;
  tempRoute.push(current);
  tempVisited.add(current);

  while (tempRoute.length < n) {
    let next = -1;
    let bestDist = Infinity;
    
    // Først: prøv å finne noen med felles tema
    for (let j = 0; j < n; j++) {
      if (!tempVisited.has(j) && 
          hasCommonThemes(people[current], people[j]) &&
          distMatrix[current][j] < bestDist) {
        bestDist = distMatrix[current][j];
        next = j;
      }
    }
    
    // Hvis ingen med felles tema, ta den nærmeste
    if (next === -1) {
      for (let j = 0; j < n; j++) {
        if (!tempVisited.has(j) && distMatrix[current][j] < bestDist) {
          bestDist = distMatrix[current][j];
          next = j;
        }
      }
    }
    
    tempRoute.push(next);
    tempVisited.add(next);
    current = next;
  }

  return tempRoute;
}

// --- 5. Forbedret 2-opt algoritme ---
function twoOpt(route, distMatrix) {
  let improved = true;
  const n = route.length;
  
  while (improved) {
    improved = false;
    
    for (let i = 1; i < n - 2; i++) {
      for (let j = i + 1; j < n - 1; j++) {
        // Beregn kostnad før swap
        const before = distMatrix[route[i-1]][route[i]] + distMatrix[route[j]][route[j+1]];
        
        // Beregn kostnad etter swap
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
            // Utfør swap: reverser segmentet fra i til j
            const segment = route.slice(i, j + 1).reverse();
            route.splice(i, j - i + 1, ...segment);
            improved = true;
            break; // Start på nytt etter swap
          }
        }
      }
      if (improved) break;
    }
  }
  
  return route;
}

// --- 6. Finn mest ulike par ---
function findFarthestPair(distMatrix) {
  let maxDist = -1;
  let pair = [0, 0];
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (distMatrix[i][j] > maxDist) {
        maxDist = distMatrix[i][j];
        pair = [i, j];
      }
    }
  }
  
  return pair;
}

// --- 7. Rotér slik at de mest ulike havner ytterst ---
function rotateToEnds(order, pair) {
  const [a,b] = pair;
  const idxA = order.indexOf(a);
  const idxB = order.indexOf(b);
  let newOrder = [...order];

  // roter så en av paret er først
  if (idxA < idxB) {
    newOrder = [...order.slice(idxA), ...order.slice(0,idxA)];
  } else {
    newOrder = [...order.slice(idxB), ...order.slice(0,idxB)];
  }

  // hvis begge ikke er ytterst, snu rekkefølgen
  if (!(
    (newOrder[0]===a && newOrder.at(-1)===b) ||
    (newOrder[0]===b && newOrder.at(-1)===a)
  )) newOrder.reverse();

  return newOrder;
}

// --- 8. Beregn total kostnad (distanse mellom to personer) ---
function calculateTotalCost(route, distMatrix) {
  let cost = 0;
  for (let i = 0; i < route.length - 1; i++) {
    cost += distMatrix[route[i]][route[i + 1]];
  }
  return cost;
}

// --- 9. Kjør algoritmen ---
console.log("🔍 Finner optimal bordplassering med multi-start...\n");

const ATTEMPTS = 100; // Økt antall siden vi fjernet SA
let bestOverallOrder = null;
let bestOverallCost = Infinity;
let improvements = 0;

console.log(`Kjører ${ATTEMPTS} forsøk med forskjellige startpunkter...\n`);

for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
  // Randomiser startpunkt for bedre variasjon
  const startIdx = Math.floor(Math.random() * n);
  
  // Start med nearest-neighbor fra dette punktet
  let order = nearestNeighborWithCommonThemes(distMatrix, people, startIdx);
  
  // 2-opt optimalisering
  order = twoOpt(order, distMatrix);
  const cost = calculateTotalCost(order, distMatrix);
  
  if (cost < bestOverallCost) {
    bestOverallCost = cost;
    bestOverallOrder = order;
    improvements++;
    console.log(`✨ Forsøk ${attempt + 1}: Ny beste = ${(cost / n).toFixed(4)} (start fra person ${startIdx})`);
  }
}

let order = bestOverallOrder;
console.log(`\n✅ Beste løsning funnet: ${(bestOverallCost / n).toFixed(4)}`);
console.log(`   Totalt ${improvements} forbedringer funnet\n`);

const farthestPair = findFarthestPair(distMatrix);
console.log(`🎯 Mest ulike par: ${people[farthestPair[0]].name} ↔ ${people[farthestPair[1]].name}`);

order = rotateToEnds(order, farthestPair);

// --- 10. Skriv ut resultat ---
console.log("\n🍽️  Optimal bordplassering:");
console.log("=" .repeat(50));

const seating = order.map(i => people[i]);

const seatingStatistics = seating.map((person, index) => {
  let previousThemes = [];
  let nextThemes = [];
  let previousSimilarity;
  let nextSimilarity;
  if (index > 0) {
    previousThemes = [...person.themes].filter(t => seating[index - 1].themes.has(t));
    previousSimilarity = distance(person.themes, seating[index - 1].themes);
  }
  if (index < n - 1) {
    nextThemes = [...person.themes].filter(t => seating[index + 1].themes.has(t));
    nextSimilarity = distance(person.themes, seating[index + 1].themes);
  }
  const commonThemes = new Set([...previousThemes, ...nextThemes]);
  const combinedSimilarity = index === 0 ? nextSimilarity : index === n - 1 ? previousSimilarity : (previousSimilarity + nextSimilarity) / 2;
  return {
    name: person.name,
    commonThemes: [...commonThemes].map(t => Array.from(t)[0]).join(" "),
    combinedSimilarity: combinedSimilarity.toFixed(2),
    hasCommon: commonThemes.size > 0
  };
});

// Valider at alle har felles tema med naboer
const isolated = seatingStatistics.filter(s => !s.hasCommon);
if (isolated.length > 0) {
  console.log("\n⚠️  ADVARSEL: Følgende personer deler IKKE tema med naboene sine:");
  isolated.forEach(s => console.log(`   - ${s.name}`));
  console.log(`   (${isolated.length} av ${n} personer)\n`);
} else {
  console.log("\n✅ Alle deler tema med minst én nabo!\n");
}

console.log("\n📋 Bordplassering med felles tema:");
console.log("─".repeat(70));
for (const statistic of seatingStatistics) {
  const status = statistic.hasCommon ? "✓" : "✗";
  const themes = statistic.commonThemes || "(ingen felles)";
  console.log(`${status} ${statistic.name.padEnd(40)} ${statistic.combinedSimilarity.padEnd(10)} ${themes}`);
}
console.log("─".repeat(70));

console.log("\n📈 Statistikk:");
console.log(`Total kostnad: ${calculateTotalCost(order, distMatrix).toFixed(3)}`);
console.log(`Antall personer: ${n}`);
console.log(`Personer med felles tema: ${n - isolated.length} av ${n}`);
console.log(`Mest ulike par: ${people[farthestPair[0]].name} ↔ ${people[farthestPair[1]].name} (avstand: ${distMatrix[farthestPair[0]][farthestPair[1]].toFixed(3)})`);

// // Vis avstandsmatrise for debugging
// console.log("\n🔢 Avstandsmatrise:");
// console.log("   ", people.map(p => p.name.substring(0, 4).padEnd(4)).join(" "));
// for (let i = 0; i < n; i++) {
//   let row = people[i].name.substring(0, 4).padEnd(4) + " ";
//   for (let j = 0; j < n; j++) {
//     row += distMatrix[i][j].toFixed(2) + " ";
//   }
//   console.log(row);
// }
