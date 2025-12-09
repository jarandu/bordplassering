import fs from "fs";
import Papa from "papaparse";
import { labels } from "./src/lib/labels.js";

const NAME_COL = "E-postadresse";
const ATTENDING_COL = "Kommer du?";
const THEMES_COL = "Hva liker du vanligvis å snakke om med andre mennesker? (Svarene blir kun brukt for dette formålet, og slettet etterpå.)";
const DISTANCE_FUNCTION: "commonality" | "avg_distance" = "commonality";
const OPTIMIZATION_MODE: "distance" | "poor_connections" = "poor_connections";

const CONSTANT_PAIRS_EMAILS: [string, string][] = [
  ["majbritt.jensen@amedia.no", "boris.sidorevitj@amedia.no"],
  ["ragnhild.harbo@amedia.no", "janne.rygh@amedia.no"],
];

interface Person {
  name: string;
  themes: Set<string>;
}

interface CSVRow {
  [key: string]: string;
}

type DistanceFunction = (a: Set<string>, b: Set<string>) => number;
type ConstantPair = [number, number];

// --- 1. Les CSV med feilhåndtering ---
let csv: string;
try {
  csv = fs.readFileSync("svar.csv", "utf8");
} catch (error) {
  const err = error as Error;
  console.error("Kunne ikke lese svar.csv:", err.message);
  process.exit(1);
}

const rows = (Papa.parse(csv, { header: true }).data as CSVRow[]).filter(
  (r) => r[ATTENDING_COL] === "Ja"
);

if (rows.length === 0) {
  console.error("Ingen gyldige rader funnet i CSV-filen");
  process.exit(1);
}

const people: Person[] = rows.map((row) => ({
  name: row[NAME_COL],
  themes: new Set(row[THEMES_COL].split(",").map((t) => t.trim())),
}));

const n = people.length;

// Create personLabels map
const personLabels = new Map<string, string>();
people.forEach((person, index) => {
  personLabels.set(person.name, labels[index % labels.length]);
});

// Create constantPairs from emails
const constantPairs: ConstantPair[] = CONSTANT_PAIRS_EMAILS.map(([email1, email2]) => {
  const idx1 = people.findIndex((p) => p.name === email1);
  const idx2 = people.findIndex((p) => p.name === email2);
  if (idx1 === -1 || idx2 === -1) {
    console.warn(`Warning: Could not find one or both persons for constant pair: ${email1}, ${email2}`);
    return null;
  }
  return [idx1, idx2];
}).filter((pair): pair is ConstantPair => pair !== null);

// --- 2. Lag avstandsmatrise ---
const distanceFunctions: Record<"avg_distance" | "commonality", DistanceFunction> = {
  avg_distance: (a, b) => {
    const inter = [...a].filter((x) => b.has(x)).length;
    const union = new Set([...a, ...b]).size;
    if (union === 0) return 1;
    return 1 - inter / union;
  },
  commonality: (a, b) => {
    const inter = [...a].filter((x) => b.has(x)).length;
    const commonCount = Math.min(inter, 4); // Begrens til maksimalt 4
    return (4 - commonCount) / 4; // 0 = nærmest (4+ felles), 1 = fjernest (0 felles)
  },
};

const distance = distanceFunctions[DISTANCE_FUNCTION];

const distMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
for (let i = 0; i < n; i++) {
  for (let j = i + 1; j < n; j++) {
    const d = distance(people[i].themes, people[j].themes);
    distMatrix[i][j] = distMatrix[j][i] = d;
  }
}

// --- 3. Hjelpefunksjon: Har to personer felles tema? ---
function hasCommonThemes(personA: Person, personB: Person): boolean {
  return [...personA.themes].some((t) => personB.themes.has(t));
}

// --- 4. Nearest-neighbor TSP heuristic med felles tema ---
function nearestNeighborWithCommonThemes(
  distMatrix: number[][],
  people: Person[],
  startIdx: number = 0
): number[] {
  const n = distMatrix.length;
  const tempRoute: number[] = [];
  const tempVisited = new Set<number>();

  let current = startIdx;
  tempRoute.push(current);
  tempVisited.add(current);

  while (tempRoute.length < n) {
    let next = -1;
    let bestDist = Infinity;

    // Først: prøv å finne noen med felles tema
    for (let j = 0; j < n; j++) {
      if (
        !tempVisited.has(j) &&
        hasCommonThemes(people[current], people[j]) &&
        distMatrix[current][j] < bestDist
      ) {
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

    if (next === -1) {
      throw new Error("Could not find next person in route");
    }

    tempRoute.push(next);
    tempVisited.add(next);
    current = next;
  }

  return tempRoute;
}

// --- 5. Forbedret 2-opt algoritme ---
function twoOpt(
  route: number[],
  distMatrix: number[][],
  constantPairs: ConstantPair[] = []
): number[] {
  let improved = true;
  const n = route.length;

  // Hjelpefunksjon for å sjekke om en swap bryter opp et konstant par
  function wouldBreakPair(i: number, j: number): boolean {
    if (constantPairs.length === 0) return false;

    // Sjekk alle konstante par
    for (const [idx1, idx2] of constantPairs) {
      const pos1 = route.indexOf(idx1);
      const pos2 = route.indexOf(idx2);

      // Sjekk om de er naboer
      const areNeighbors =
        Math.abs(pos1 - pos2) === 1 ||
        (pos1 === 0 && pos2 === n - 1) ||
        (pos2 === 0 && pos1 === n - 1);

      if (areNeighbors) {
        // Sjekk om swap vil bryte opp dette paret
        // Etter swap vil segmentet fra i til j være reversert
        // Hvis begge er inne i segmentet, vil de fortsatt være naboer (bare reversert)
        // Hvis bare én er inne i segmentet, bryter det opp paret
        const pos1InSegment = pos1 >= i && pos1 <= j;
        const pos2InSegment = pos2 >= i && pos2 <= j;

        // Hvis bare én av dem er i segmentet, bryter det opp paret
        if (pos1InSegment !== pos2InSegment) {
          return true;
        }

        // Hvis begge er i segmentet, sjekk om de fortsatt vil være naboer etter reversering
        if (pos1InSegment && pos2InSegment) {
          // Etter reversering vil posisjonene være: j - (pos - i)
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

  while (improved) {
    improved = false;

    for (let i = 1; i < n - 2; i++) {
      for (let j = i + 1; j < n - 1; j++) {
        // Ikke utfør swap hvis det bryter opp et konstant par
        if (wouldBreakPair(i, j)) {
          continue;
        }

        // Beregn kostnad før swap
        const before =
          distMatrix[route[i - 1]][route[i]] + distMatrix[route[j]][route[j + 1]];

        // Beregn kostnad etter swap
        const after =
          distMatrix[route[i - 1]][route[j]] + distMatrix[route[i]][route[j + 1]];

        if (after < before) {
          let isolationPenalty = 0;
          if (!hasCommonThemes(people[route[i - 1]], people[route[j]])) {
            isolationPenalty += 0.5;
          }
          if (!hasCommonThemes(people[route[i]], people[route[j + 1]])) {
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
function findFarthestPair(distMatrix: number[][]): [number, number] {
  let maxDist = -1;
  let pair: [number, number] = [0, 0];

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
function rotateToEnds(order: number[], pair: [number, number]): number[] {
  const [a, b] = pair;
  const idxA = order.indexOf(a);
  const idxB = order.indexOf(b);
  let newOrder = [...order];

  // roter så en av paret er først
  if (idxA < idxB) {
    newOrder = [...order.slice(idxA), ...order.slice(0, idxA)];
  } else {
    newOrder = [...order.slice(idxB), ...order.slice(0, idxB)];
  }

  // hvis begge ikke er ytterst, snu rekkefølgen
  if (
    !(
      (newOrder[0] === a && newOrder.at(-1) === b) ||
      (newOrder[0] === b && newOrder.at(-1) === a)
    )
  )
    newOrder.reverse();

  return newOrder;
}

// --- 8. Beregn total kostnad (distanse mellom to personer) ---
function calculateTotalCost(route: number[], distMatrix: number[][]): number {
  let cost = 0;
  for (let i = 0; i < route.length - 1; i++) {
    cost += distMatrix[route[i]][route[i + 1]];
  }
  return cost;
}

// --- 8b. Beregn antall personer med 2 eller færre felles tema ---
function countPoorConnections(route: number[], people: Person[]): number {
  let poorCount = 0;

  for (let i = 0; i < route.length; i++) {
    const person = people[route[i]];
    const totalCommonThemes = new Set<string>();

    // Sjekk forrige person
    if (i > 0) {
      const prev = people[route[i - 1]];
      [...person.themes].forEach((t) => {
        if (prev.themes.has(t)) totalCommonThemes.add(t);
      });
    }

    // Sjekk neste person
    if (i < route.length - 1) {
      const next = people[route[i + 1]];
      [...person.themes].forEach((t) => {
        if (next.themes.has(t)) totalCommonThemes.add(t);
      });
    }

    // Tell om personen har 2 eller færre felles tema
    if (totalCommonThemes.size <= 2) {
      poorCount++;
    }
  }

  return poorCount;
}

// --- Helper function to enforce constant pairs ---
function enforceConstantPairs(
  order: number[],
  constantPairs: ConstantPair[]
): number[] {
  if (constantPairs.length === 0) return order;

  const newOrder = [...order];

  for (const [idx1, idx2] of constantPairs) {
    const pos1 = newOrder.indexOf(idx1);
    const pos2 = newOrder.indexOf(idx2);
    const n = newOrder.length;

    // Sjekk om de allerede er naboer
    const areNeighbors =
      Math.abs(pos1 - pos2) === 1 ||
      (pos1 === 0 && pos2 === n - 1) ||
      (pos2 === 0 && pos1 === n - 1);

    if (!areNeighbors) {
      // Flytt dem så de blir naboer
      // Enkel strategi: flytt den ene ved siden av den andre
      if (pos1 < pos2) {
        // Flytt idx2 til posisjon rett etter idx1
        newOrder.splice(pos2, 1);
        newOrder.splice(pos1 + 1, 0, idx2);
      } else {
        // Flytt idx1 til posisjon rett etter idx2
        newOrder.splice(pos1, 1);
        newOrder.splice(pos2 + 1, 0, idx1);
      }
    }
  }

  return newOrder;
}

// --- 9. Kjør algoritmen ---
console.log("🔍 Finner optimal bordplassering med multi-start...\n");

const ATTEMPTS = 1000;
let bestOverallOrder: number[] | null = null;
let bestOverallScore = Infinity;
let improvements = 0;

const modeLabel =
  OPTIMIZATION_MODE === "distance"
    ? "avstand (minimerer total distanse)"
    : "dårlige tilkoblinger (minimerer personer med ≤2 felles tema)";
console.log(`Optimaliserer for: ${modeLabel}`);
console.log(`Kjører ${ATTEMPTS} forsøk med forskjellige startpunkter...\n`);

for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
  // Randomiser startpunkt for bedre variasjon
  const startIdx = Math.floor(Math.random() * n);

  // Start med nearest-neighbor fra dette punktet
  let order = nearestNeighborWithCommonThemes(distMatrix, people, startIdx);

  // 2-opt optimalisering (respekterer konstante par)
  order = twoOpt(order, distMatrix, constantPairs);

  // Sikre at konstante par er naboer (i tilfelle de ble brutt opp)
  order = enforceConstantPairs(order, constantPairs);

  // Velg evalueringsmetode basert på OPTIMIZATION_MODE
  const score =
    OPTIMIZATION_MODE === "distance"
      ? calculateTotalCost(order, distMatrix)
      : countPoorConnections(order, people);

  if (score < bestOverallScore) {
    bestOverallScore = score;
    bestOverallOrder = order;
    improvements++;

    const scoreLabel =
      OPTIMIZATION_MODE === "distance"
        ? `${(score / n).toFixed(4)} gjennomsnittlig avstand`
        : `${score} personer med ≤2 felles tema`;
    console.log(
      `✨ Forsøk ${attempt + 1}: Ny beste = ${scoreLabel} (start fra person ${startIdx})`
    );
  }
}

if (bestOverallOrder === null) {
  console.error("Kunne ikke finne en løsning");
  process.exit(1);
}

const order = bestOverallOrder;

const finalLabel =
  OPTIMIZATION_MODE === "distance"
    ? `${(bestOverallScore / n).toFixed(4)} gjennomsnittlig avstand`
    : `${bestOverallScore} personer med ≤2 felles tema`;
console.log(`\n✅ Beste løsning funnet: ${finalLabel}`);

const seating = order.map((i) => people[i]);

interface SeatingStatistic {
  name: string;
  label: string | undefined;
  commonThemes: string[];
  combinedSimilarity: string;
  hasCommon: boolean;
}

const seatingStatistics: SeatingStatistic[] = seating.map((person, index) => {
  let previousThemes: string[] = [];
  let nextThemes: string[] = [];
  let previousSimilarity: number | undefined;
  let nextSimilarity: number | undefined;
  if (index > 0) {
    previousThemes = [...person.themes].filter((t) =>
      seating[index - 1].themes.has(t)
    );
    previousSimilarity = distance(person.themes, seating[index - 1].themes);
  }
  if (index < n - 1) {
    nextThemes = [...person.themes].filter((t) =>
      seating[index + 1].themes.has(t)
    );
    nextSimilarity = distance(person.themes, seating[index + 1].themes);
  }
  const commonThemes = new Set([...previousThemes, ...nextThemes]);
  const combinedSimilarity =
    index === 0
      ? nextSimilarity!
      : index === n - 1
      ? previousSimilarity!
      : (previousSimilarity! + nextSimilarity!) / 2;
  return {
    name: person.name,
    label: personLabels.get(person.name),
    commonThemes: [...commonThemes],
    combinedSimilarity: combinedSimilarity.toFixed(2),
    hasCommon: commonThemes.size > 0,
  };
});

console.log("\n📋 Bordplassering med felles tema:");
console.log("─".repeat(70));
for (const statistic of seatingStatistics) {
  const status = statistic.commonThemes.length > 1 ? "✓" : "✗";
  console.log(
    `${status} ${statistic.name.padEnd(40)} [${statistic.label || ""}] ${statistic.combinedSimilarity.padEnd(10)} ${statistic.commonThemes.map((t) => Array.from(t)[0]).join(", ")}`
  );
}

// Valider
const isolated = seatingStatistics.filter((s) => !s.hasCommon);
const onlyOneCommon = seatingStatistics.filter(
  (s) => s.commonThemes.length === 1
);
const onlyTwoCommon = seatingStatistics.filter(
  (s) => s.commonThemes.length === 2
);
if (isolated.length > 0) {
  console.log(
    `⚠️  ADVARSEL: ${isolated.length} personer deler IKKE tema med naboene sine:`
  );
  isolated.forEach((s) =>
    console.log(`   - ${s.name} (${s.commonThemes.join(", ")})`)
  );
} else {
  console.log("\n✅ Alle deler tema med minst én nabo!\n");
}
if (onlyOneCommon.length > 0) {
  console.log(
    `⚠️  ADVARSEL: ${onlyOneCommon.length} personer deler kun ett tema med naboene sine:`
  );
  onlyOneCommon.forEach((s) =>
    console.log(`   - ${s.name} (${s.commonThemes.join(", ")})`)
  );
} else {
  console.log("✅ Alle deler minst to tema med naboene!\n");
}

console.log(
  `${onlyTwoCommon.length} personer deler kun to tema med naboene sine`
);

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

