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

  private getCanonicalCell(cell: Cell): Cell {
    const key = `${cell.i},${cell.j}`;
    if (!this.knownCells.has(key)) {
      this.knownCells.set(key, cell);
    }
    return this.knownCells.get(key)!;
  }

  getCellForPoint(point: leaflet.LatLng): Cell {
    return this.getCanonicalCell(toGridCell(point.lat, point.lng));
  }

  getCellBounds(cell: Cell): leaflet.LatLngBounds {
    return leaflet.latLngBounds(
      [cell.i / 1e4, cell.j / 1e4],
      [(cell.i + 1) / 1e4, (cell.j + 1) / 1e4],
    );
  }

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

// cache class using the Memento pattern for state management
interface Memento<T> {
  toMemento(): T;
  fromMemento(memento: T): void;
}

class Cache implements Memento<string> {
  pointValue: number;
  cacheCoins: number;

  constructor(public i: number, public j: number) {
    this.pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 100);
    this.cacheCoins = 0;
  }

  toMemento(): string {
    return JSON.stringify({
      pointValue: this.pointValue,
      cacheCoins: this.cacheCoins,
    });
  }

  fromMemento(memento: string): void {
    const state = JSON.parse(memento);
    this.pointValue = state.pointValue;
    this.cacheCoins = state.cacheCoins;
  }
}

// cacheRenderer class to handle map-based rendering for caches
class CacheRenderer {
  private rectangle: leaflet.Rectangle | null = null;

  constructor(
    private readonly map: leaflet.Map,
    private readonly cache: Cache,
    private readonly board: Board,
  ) {}

  drawCache() {
    if (!this.rectangle) {
      const bounds = this.board.getCellBounds({
        i: this.cache.i,
        j: this.cache.j,
      });
      this.rectangle = leaflet.rectangle(bounds).addTo(this.map).bindPopup(() =>
        this.createCachePopup()
      );
    }
  }

  removeCacheMarker() {
    if (this.rectangle) {
      this.map.removeLayer(this.rectangle);
      this.rectangle = null;
    }
  }

  private createCachePopup() {
    const popupDiv = document.createElement("div");
    const coinId = `${this.cache.i}:${this.cache.j}#${
      Math.floor(Math.random() * 1000)
    }`;

    popupDiv.innerHTML = `
      <div>Coin ID: <a href="#" onclick="return false;">${coinId}</a></div>
      <div>Cache at "${this.cache.i},${this.cache.j}". Value: <span id="value">${this.cache.pointValue}</span>. Coins: <span id="cacheCoins">${this.cache.cacheCoins}</span></div>
      <button id="collect">Collect Coin</button>
      <button id="deposit">Deposit Coin</button>`;

    popupDiv.querySelector<HTMLAnchorElement>("a")!.addEventListener(
      "click",
      () => {
        const [i, j] = coinId.split("#")[0].split(":").map(Number);
        const targetPosition = leaflet.latLng(i / 1e4, j / 1e4);
        this.map.setView(targetPosition, GAMEPLAY_ZOOM_LEVEL);
      },
    );

    popupDiv.querySelector<HTMLButtonElement>("#collect")!.addEventListener(
      "click",
      () => {
        if (this.cache.pointValue > 0) {
          this.cache.pointValue--;
          playerCoins++;
          coinsAvailableForDeposit++;
          updateStatusPanel();
          popupDiv.querySelector<HTMLSpanElement>("#value")!.innerText = this
            .cache.pointValue.toString();
          saveGameState();
        }
      },
    );

    popupDiv.querySelector<HTMLButtonElement>("#deposit")!.addEventListener(
      "click",
      () => {
        if (coinsAvailableForDeposit > 0) {
          coinsAvailableForDeposit--;
          this.cache.cacheCoins++;
          updateStatusPanel();
          popupDiv.querySelector<HTMLSpanElement>("#cacheCoins")!.innerText =
            this.cache.cacheCoins.toString();
          saveGameState();
        }
      },
    );

    return popupDiv;
  }
}

// GeolocationFacade for managing geolocation services
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

// constants
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// game state variables
const board = new Board(TILE_DEGREES, NEIGHBORHOOD_SIZE);
let map: leaflet.Map;
let playerMarker: leaflet.Marker<leaflet.LatLng>;
let playerPolyline: leaflet.Polyline;
let playerPosition = leaflet.latLng(36.98949379578401, -122.06277128548504);
const playerPath: leaflet.LatLng[] = [];
const cacheStates = new Map<string, Cache>();
const cacheRenderers = new Map<string, CacheRenderer>();
let visitedCells = new Set<string>();
let playerCoins = 0;
let coinsAvailableForDeposit = 0;
const geolocationFacade = new GeolocationFacade();

document.addEventListener("DOMContentLoaded", () => {
  loadGameState();
  initializeMap();
  setupPlayerMovement();
  updateStatusPanel();
  document.getElementById("sensor")!.addEventListener(
    "click",
    () => toggleGeolocation(),
  );
  document.getElementById("reset")!.addEventListener(
    "click",
    () => resetGame(),
  );
});

function initializeMap() {
  map = leaflet.map(document.getElementById("map")!, {
    center: playerPosition,
    zoom: GAMEPLAY_ZOOM_LEVEL,
    minZoom: GAMEPLAY_ZOOM_LEVEL,
    maxZoom: GAMEPLAY_ZOOM_LEVEL,
    zoomControl: false,
  });

  leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(map);

  playerMarker = leaflet.marker(playerPosition).addTo(map).bindTooltip(
    "That's you!",
  );
  playerPolyline = leaflet.polyline(playerPath, { color: "blue" }).addTo(map);
  repopulateCaches();
}

function repopulateCaches() {
  const visibleCells = new Set(
    board.getCellsNearPoint(playerPosition).map((cell) =>
      `${cell.i}:${cell.j}`
    ),
  );

  cacheRenderers.forEach((renderer, cacheKey) => {
    if (!visibleCells.has(cacheKey)) {
      renderer.removeCacheMarker();
      cacheRenderers.delete(cacheKey);
    }
  });

  visibleCells.forEach((cacheKey) => {
    let cache = cacheStates.get(cacheKey);

    const isVisited = visitedCells.has(cacheKey) ||
      localStorage.getItem(cacheKey) != null;

    if (!isVisited) {
      visitedCells.add(cacheKey);

      if (!cache && Math.random() < CACHE_SPAWN_PROBABILITY) {
        const [i, j] = cacheKey.split(":").map(Number);
        cache = new Cache(i, j);
        cacheStates.set(cacheKey, cache);
      }
    }

    if (cache && !cacheRenderers.has(cacheKey)) {
      const renderer = new CacheRenderer(map, cache, board);
      renderer.drawCache();
      cacheRenderers.set(cacheKey, renderer);
    }
  });
}

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

function updateStatusPanel() {
  const statusPanel = document.getElementById("statusPanel")!;
  statusPanel.innerHTML =
    `Total coins collected: ${playerCoins}, Coins available for deposit: ${coinsAvailableForDeposit}`;
}

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

function movePlayer(dx: number, dy: number) {
  playerPosition = leaflet.latLng(
    playerPosition.lat + dy,
    playerPosition.lng + dx,
  );
  playerMarker.setLatLng(playerPosition);
  map.panTo(playerPosition);

  playerPath.push(playerPosition);
  playerPolyline.setLatLngs(playerPath);

  repopulateCaches();
  saveGameState();
}

function toggleGeolocation() {
  if (!geolocationFacade.tracking) {
    geolocationFacade.startTracking((position) => {
      playerPosition = leaflet.latLng(
        position.coords.latitude,
        position.coords.longitude,
      );
      playerMarker.setLatLng(playerPosition);
      map.panTo(playerPosition);

      playerPath.push(playerPosition);
      playerPolyline.setLatLngs(playerPath);

      repopulateCaches();
      saveGameState();
    });
    alert("Geolocation tracking started.");
  } else {
    geolocationFacade.stopTracking();
    alert("Geolocation tracking stopped.");
  }
}

function resetGame() {
  const confirmation = globalThis.confirm(
    "Are you sure you want to reset the game state? This will erase all your progress.",
  );
  if (confirmation) {
    geolocationFacade.stopTracking();
    localStorage.clear();
    globalThis.location.reload();
  }
}
//
