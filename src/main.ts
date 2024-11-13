// imports
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./leafletWorkaround.ts";
import luck from "./luck.ts";

// oakes classroom reference
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);

// game parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// wait for the DOM to load before initializing the map
document.addEventListener("DOMContentLoaded", () => {
  // create id map reference
  const map = leaflet.map(document.getElementById("map")!, {
    center: OAKES_CLASSROOM,
    zoom: GAMEPLAY_ZOOM_LEVEL,
    minZoom: GAMEPLAY_ZOOM_LEVEL,
    maxZoom: GAMEPLAY_ZOOM_LEVEL,
    zoomControl: false,
    scrollWheelZoom: false,
  });

  // add tile layer to the map
  leaflet
    .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    })
    .addTo(map);

  // add a player marker to the map
  const playerMarker = leaflet.marker(OAKES_CLASSROOM);
  playerMarker.bindTooltip("That's you!");
  playerMarker.addTo(map);

  // player points display
  let playerPoints = 0;
  let playerCoins = 0;
  const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
  statusPanel.innerHTML = "No points yet...";

  // function to spawn caches on the map
  function spawnCache(i: number, j: number) {
    const origin = OAKES_CLASSROOM;
    const bounds = leaflet.latLngBounds([
      [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
      [
        origin.lat + (i + 1) * TILE_DEGREES,
        origin.lng + (j + 1) * TILE_DEGREES,
      ],
    ]);

    const rect = leaflet.rectangle(bounds);
    rect.addTo(map);

    // random point value and coin count
    let pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 100);
    let cacheCoins = 0;

    rect.bindPopup(() => {
      const popupDiv = document.createElement("div");
      popupDiv.innerHTML = `
                  <div>Cache at "${i},${j}". Value: <span id="value">${pointValue}</span>. Coins: <span id="cacheCoins">${cacheCoins}</span></div>
                  <button id="collect">Collect Coin</button>
                  <button id="deposit">Deposit Coin</button>`;

      // button click to collect coin
      popupDiv
        .querySelector<HTMLButtonElement>("#collect")!
        .addEventListener("click", () => {
          if (pointValue > 0) {
            pointValue--;
            popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML =
              pointValue.toString();
            playerCoins++;
            playerPoints++;
            statusPanel.innerHTML =
              `${playerPoints} points accumulated | ${playerCoins} coins collected`;
          }
        });

      // button click to deposit coin
      popupDiv
        .querySelector<HTMLButtonElement>("#deposit")!
        .addEventListener("click", () => {
          if (playerCoins > 0) {
            playerCoins--;
            cacheCoins++;
            popupDiv.querySelector<HTMLSpanElement>("#cacheCoins")!.innerHTML =
              cacheCoins.toString();
            statusPanel.innerHTML =
              `${playerPoints} points accumulated | ${playerCoins} coins collected`;
          }
        });

      return popupDiv;
    });
  }

  // populate the map with caches
  for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
    for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
      if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(i, j);
      }
    }
  }
});
