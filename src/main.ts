// imports and leaflet setup
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./leafletWorkaround.ts";
import luck from "./luck.ts";

// converts latitude and longitude into grid indices
function toGridCell(
  latitude: number,
  longitude: number,
): { i: number; j: number } {
  return { i: Math.round(latitude * 1e4), j: Math.round(longitude * 1e4) };
}

// board class utilizing the flyweight pattern to manage unique cell instances
interface Cell {
  readonly i: number;
  readonly j: number;
}

class Board {
  private readonly knownCells = new Map<string, Cell>();

  constructor(
    public readonly tileWidth: number,
    public readonly tileVisibilityRadius: number,
  ) {}

  // retrieves or creates a unique cell instance
  private getCanonicalCell(cell: Cell): Cell {
    const key = `${cell.i},${cell.j}`;
    if (!this.knownCells.has(key)) {
      this.knownCells.set(key, cell);
    }
    return this.knownCells.get(key)!;
  }

  // gets the cell corresponding to a given point
  getCellForPoint(point: leaflet.LatLng): Cell {
    return this.getCanonicalCell(toGridCell(point.lat, point.lng));
  }

  // retrieves the bounding box for a cell
  getCellBounds(cell: Cell): leaflet.LatLngBounds {
    return leaflet.latLngBounds(
      [cell.i / 1e4, cell.j / 1e4],
      [(cell.i + 1) / 1e4, (cell.j + 1) / 1e4],
    );
  }

  // gathers all cells within the player's viewing radius
  getCellsNearPoint(point: leaflet.LatLng): Cell[] {
    const originCell = this.getCellForPoint(point);
    const cells: Cell[] = [];
    for (
      let i = -this.tileVisibilityRadius;
      i <= this.tileVisibilityRadius;
      i++
    ) {
      for (
        let j = -this.tileVisibilityRadius;
        j <= this.tileVisibilityRadius;
        j++
      ) {
        cells.push(
          this.getCanonicalCell({ i: originCell.i + i, j: originCell.j + j }),
        );
      }
    }
    return cells;
  }
}

// cache class using the memento pattern for state management
interface Memento<T> {
  toMemento(): T;
  fromMemento(memento: T): void;
}

class Cache implements Memento<string> {
  pointValue: number;
  cacheCoins: number;
  marker: leaflet.Rectangle | null = null;

  constructor(public i: number, public j: number) {
    this.pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 100);
    this.cacheCoins = 0;
  }

  // saves cache state to a string
  toMemento(): string {
    return JSON.stringify({
      pointValue: this.pointValue,
      cacheCoins: this.cacheCoins,
    });
  }

  // restores cache state from a string
  fromMemento(memento: string): void {
    const state = JSON.parse(memento);
    this.pointValue = state.pointValue;
    this.cacheCoins = state.cacheCoins;
  }
}

// facade for geolocation
class GeolocationFacade {
  tracking: boolean = false;
  watchId: number | null = null;

  startTracking(callback: (position: GeolocationPosition) => void): void {
    if (navigator.geolocation && !this.tracking) {
      this.watchId = navigator.geolocation.watchPosition(callback);
      this.tracking = true;
    }
  }

  stopTracking(): void {
    if (this.tracking && this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.tracking = false;
    }
  }
}

// game parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// board and game state variables
const board = new Board(TILE_DEGREES, NEIGHBORHOOD_SIZE);
let map: leaflet.Map;
let playerMarker: leaflet.Marker<leaflet.LatLng>;
let playerPolyline: leaflet.Polyline;
let playerPosition = leaflet.latLng(36.98949379578401, -122.06277128548504);
const playerPath: leaflet.LatLng[] = [];
const cacheStates = new Map<string, Cache>();
let visitedCells = new Set<string>();
let playerCoins = 0;
let coinsAvailableForDeposit = 0;
const geolocationFacade = new GeolocationFacade();

// initializes the map and player controls once the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  loadGameState(); // Load the saved state
  initializeMap();
  setupPlayerMovement();
  updateStatusPanel();
});

// creates and initializes the map and player marker
function initializeMap() {
  map = leaflet.map(document.getElementById("map")!, {
    center: playerPosition,
    zoom: GAMEPLAY_ZOOM_LEVEL,
    minZoom: GAMEPLAY_ZOOM_LEVEL,
    maxZoom: GAMEPLAY_ZOOM_LEVEL,
    zoomControl: false,
    scrollWheelZoom: false,
  });

  leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  playerMarker = leaflet.marker(playerPosition).addTo(map).bindTooltip(
    "That's you!",
  );

  playerPolyline = leaflet.polyline(playerPath, { color: "blue" }).addTo(map);

  repopulateCaches();

  document.getElementById("sensor")!.addEventListener(
    "click",
    toggleGeolocation,
  );
  document.getElementById("reset")!.addEventListener("click", resetGame);
}

// sets up movement event listeners for the player
function setupPlayerMovement() {
  document.getElementById("north")!.addEventListener(
    "click",
    () => movePlayer(0, TILE_DEGREES),
  );
  document.getElementById("south")!.addEventListener(
    "click",
    () => movePlayer(0, -TILE_DEGREES),
  );
  document.getElementById("west")!.addEventListener(
    "click",
    () => movePlayer(-TILE_DEGREES, 0),
  );
  document.getElementById("east")!.addEventListener(
    "click",
    () => movePlayer(TILE_DEGREES, 0),
  );
}

// persists game state to local storage
function saveGameState() {
  localStorage.setItem("playerPosition", JSON.stringify(playerPosition));
  localStorage.setItem("playerCoins", playerCoins.toString());
  localStorage.setItem(
    "coinsAvailableForDeposit",
    coinsAvailableForDeposit.toString(),
  );
  localStorage.setItem(
    "visitedCells",
    JSON.stringify(Array.from(visitedCells)),
  );
  localStorage.setItem(
    "cacheStates",
    JSON.stringify(
      Array.from(cacheStates.entries()).map((
        [key, cache],
      ) => [key, cache.toMemento()]),
    ),
  );
  localStorage.setItem(
    "playerPath",
    JSON.stringify(playerPath.map((pos) => [pos.lat, pos.lng])),
  );
}

// loads game state from local storage
function loadGameState() {
  const loadedPosition = localStorage.getItem("playerPosition");
  if (loadedPosition) {
    playerPosition = leaflet.latLng(JSON.parse(loadedPosition));
  }

  const loadedCoins = localStorage.getItem("playerCoins");
  if (loadedCoins) {
    playerCoins = parseInt(loadedCoins, 10);
  }

  const loadedCoinsForDeposit = localStorage.getItem(
    "coinsAvailableForDeposit",
  );
  if (loadedCoinsForDeposit) {
    coinsAvailableForDeposit = parseInt(loadedCoinsForDeposit, 10);
  }

  const loadedVisitedCells = localStorage.getItem("visitedCells");
  if (loadedVisitedCells) {
    visitedCells = new Set(JSON.parse(loadedVisitedCells));
  }

  const loadedCacheStates = localStorage.getItem("cacheStates");
  if (loadedCacheStates) {
    cacheStates.clear();
    JSON.parse(loadedCacheStates).forEach(
      ([key, memento]: [string, string]) => {
        const [i, j] = key.split(":").map(Number);
        const cache = new Cache(i, j);
        cache.fromMemento(memento);
        cacheStates.set(key, cache);
      },
    );
  }

  const loadedPath = localStorage.getItem("playerPath");
  if (loadedPath) {
    playerPath.length = 0;
    playerPath.push(
      ...JSON.parse(loadedPath).map((coords: [number, number]) =>
        leaflet.latLng(coords)
      ),
    );
  }
}

// populates caches in the visible cells with respect to previously visited or stored cells
function repopulateCaches() {
  const visibleCells = new Set(
    board.getCellsNearPoint(playerPosition).map((cell) =>
      `${cell.i}:${cell.j}`
    ),
  );

  // removes markers for caches no longer in view
  cacheStates.forEach((cache, cacheKey) => {
    if (!visibleCells.has(cacheKey) && cache.marker) {
      map.removeLayer(cache.marker);
      cache.marker = null;
    }
  });

  // assess and populate caches
  visibleCells.forEach((cacheKey) => {
    let cache = cacheStates.get(cacheKey);

    // checks if the cell has been visited or already has a cache stored
    const isVisited = visitedCells.has(cacheKey) ||
      localStorage.getItem(cacheKey) != null;

    if (!isVisited) {
      // mark cell as visited (only do this once per cell)
      visitedCells.add(cacheKey);

      // only allow new caches if the cell is unvisited
      if (!cache && Math.random() < CACHE_SPAWN_PROBABILITY) {
        const [i, j] = cacheKey.split(":").map(Number);
        cache = new Cache(i, j);
        cacheStates.set(cacheKey, cache);
      }
    }

    // if a cache exists but is not drawn, draw it
    if (cache && !cache.marker) {
      drawCache(cache);
    }
  });
}

// draws the cache on the map and sets up its interactions
function drawCache(cache: Cache) {
  const bounds = board.getCellBounds({ i: cache.i, j: cache.j });
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map).bindPopup(() => createCachePopup(cache));
  cache.marker = rect;
}

// generates the popup content and functionality for the cache
function createCachePopup(cache: Cache) {
  const popupDiv = document.createElement("div");
  const coinId = `${cache.i}:${cache.j}#${Math.floor(Math.random() * 1000)}`;

  popupDiv.innerHTML = `
    <div>Coin ID: <a href="#" onclick="return false;">${coinId}</a></div>
    <div>Cache at "${cache.i},${cache.j}". Value: <span id="value">${cache.pointValue}</span>. Coins: <span id="cacheCoins">${cache.cacheCoins}</span></div>
    <button id="collect">Collect Coin</button>
    <button id="deposit">Deposit Coin</button>`;

  popupDiv.querySelector<HTMLAnchorElement>("a")!.addEventListener(
    "click",
    () => {
      const [i, j] = coinId.split("#")[0].split(":").map(Number);
      const targetPosition = leaflet.latLng(i / 1e4, j / 1e4);
      map.setView(targetPosition, GAMEPLAY_ZOOM_LEVEL); // center the map on the coin's home cache
    },
  );

  popupDiv.querySelector<HTMLButtonElement>("#collect")!.addEventListener(
    "click",
    () => {
      if (cache.pointValue > 0) {
        cache.pointValue--;
        playerCoins++;
        coinsAvailableForDeposit++;
        updateStatusPanel();
        popupDiv.querySelector<HTMLSpanElement>("#value")!.innerText = cache
          .pointValue.toString();
        saveGameState();
      }
    },
  );

  popupDiv.querySelector<HTMLButtonElement>("#deposit")!.addEventListener(
    "click",
    () => {
      if (coinsAvailableForDeposit > 0) {
        coinsAvailableForDeposit--;
        cache.cacheCoins++;
        updateStatusPanel();
        popupDiv.querySelector<HTMLSpanElement>("#cacheCoins")!.innerText =
          cache.cacheCoins.toString();
        saveGameState();
      }
    },
  );

  return popupDiv;
}

// updates the status panel with player's current coin stats
function updateStatusPanel() {
  const statusPanel = document.getElementById("statusPanel")!;
  statusPanel.innerHTML =
    `Total coins collected: ${playerCoins}, Coins available for deposit: ${coinsAvailableForDeposit}`;
}

// handles the movement of the player and view updates
function movePlayer(dx: number, dy: number) {
  playerPosition = leaflet.latLng(
    playerPosition.lat + dy,
    playerPosition.lng + dx,
  );
  playerMarker.setLatLng(playerPosition);
  map.panTo(playerPosition);

  playerPath.push(playerPosition); // record player movement
  playerPolyline.setLatLngs(playerPath);

  repopulateCaches();

  saveGameState(); // save game state after movement
}

// toggles geolocation tracking
function toggleGeolocation() {
  if (!geolocationFacade.tracking) {
    geolocationFacade.startTracking((position) => {
      playerPosition = leaflet.latLng(
        position.coords.latitude,
        position.coords.longitude,
      );
      playerMarker.setLatLng(playerPosition);
      map.panTo(playerPosition);

      playerPath.push(playerPosition); // record geolocation movement
      playerPolyline.setLatLngs(playerPath);

      repopulateCaches();
      saveGameState();
    });
    alert("Geolocation tracking started.");
  }
}

// resets the game state with confirmation
function resetGame() {
  const confirmation = globalThis.confirm(
    "Are you sure you want to reset the game state? This will erase all your progress.",
  );
  if (confirmation) {
    // stop geolocation during reset
    geolocationFacade.stopTracking();
    // clear local storage to reset game state
    localStorage.clear();
    // refresh the page to reinitialize to the default state
    globalThis.location.reload();
  }
}
