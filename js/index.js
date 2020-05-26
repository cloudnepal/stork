/* eslint-disable no-undef */

import init, {
  wasm_search,
  get_index_version as getIndexVersion
} from "../pkg/stork";

import WasmQueue from "./wasmqueue";
import { Entity } from "./entity";
import { loadIndexFromUrl } from "./indexLoader";

import { defaultConfig, calculateOverriddenConfig } from "./config";

const prod = process.env.NODE_ENV === "production";
const wasmUrl = prod
  ? "https://files.stork-search.net/stork.wasm"
  : "http://127.0.0.1:8025/stork.wasm";

const wasmQueue = new WasmQueue();
const entities = {};

init(wasmUrl).then(() => {
  wasmQueue.loaded = true;
  wasmQueue.handleWasmLoad();
});

async function resolveSearch(index, query) {
  if (!wasmQueue.loaded) {
    return null;
  }
  try {
    return JSON.parse(wasm_search(index, query));
  } catch (e) {
    // analytics.log(e)
  }
}

function handleInputEvent(event) {
  const name = event.target.getAttribute("data-stork");
  const query = event.target.value;

  entities[name].query = query;

  if (entities[name].index) {
    // eslint-disable-next-line no-use-before-define
    performSearch(name);
  }

  entities[name].render();
}

/**
 * Handle non-input keypresses for the input field, e.g. arrow keys.
 * (keypress event doesn't work here)
 */
function handleKeyDownEvent(event) {
  console.log(event);
  const LEFT = 37;
  const UP = 38;
  const RIGHT = 39;
  const DOWN = 40;
  const RETURN = 13;

  const name = event.target.getAttribute("data-stork");
  const entity = entities[name];

  const resultNodeArray = Array.from(
    entity.elements.list ? entity.elements.list.childNodes : []
  ).filter(n => n.className == "stork-result");

  switch (event.keyCode) {
    case DOWN:
      entity.changeHighlightedResult(+1);
      break;

    case UP:
      entity.changeHighlightedResult(-1);
      break;

    case RETURN:
      Array.from(resultNodeArray[entity.highlightedResult].childNodes)
        .filter(n => n.href)[0] // get the `a` element
        .click();

      break;

    default:
      return;
  }

  console.log(entities[name]);
  entities[name].render();
}

function performSearch(name) {
  if (!entities[name]) {
    return;
  }

  if (entities[name].elements.input.value) {
    entities[name].query = entities[name].elements.input.value;
  }

  const { query } = entities[name];
  if (query && query.length >= 3) {
    resolveSearch(entities[name].index, query).then(results => {
      // Results might be undefined if resolveSearch errored. However, if this
      // happens, resolveSearch should log the error itself.
      if (!results) {
        return;
      }

      if (process.env.NODE_ENV === "development") {
        console.log(results);
      }

      entities[name].results = results.results;
      entities[name].hitCount = results.total_hit_count;

      // Mutate the result URL, like we do when there's a url prefix or suffix
      const urlPrefix = results.url_prefix || "";
      entities[name].results.map(r => {
        const urlSuffix = () => {
          if (r.excerpts[0]) {
            if (r.excerpts[0].internal_annotations) {
              if (r.excerpts[0].internal_annotations[0]) {
                if (r.excerpts[0].internal_annotations[0]["a"]) {
                  return r.excerpts[0].internal_annotations[0]["a"];
                }
              }
            }
          }
          return "";
        };
        r.entry.url = `${urlPrefix}${r.entry.url}${urlSuffix()}`;
      });

      entities[name].render();
    });
  } else {
    entities[name].results = [];
    entities[name].render();
  }
}

function handleDownloadProgress(percentage, entity) {
  entity.progress = percentage;
  if (entity.config.showProgress) {
    entity.render();
  }
}

function handleLoadedIndex(event, entity) {
  const { response } = event.target;
  entity.progress = 1;
  entity.index = new Uint8Array(response);
  entity.indexSize = response.byteLength;

  wasmQueue.runAfterWasmLoaded(() => {
    Object.keys(entities).forEach(key => {
      performSearch(key);
    });
  });

  if (entity.config.printIndexInfo) {
    wasmQueue.runAfterWasmLoaded(() => {
      // eslint-disable-next-line no-console
      console.log({
        name: entity.name,
        sizeInBytes: entity.indexSize,
        indexVersion: getIndexVersion(entity.index)
      });
    });
  }
}

export function register(name, url, config = {}) {
  // assert that name is a string, url is a string, and config is a Partial<Configuration>

  let entity = new Entity(name, url, config);
  entities[name] = entity;

  loadIndexFromUrl(entity, url, {
    load: handleLoadedIndex,
    progress: handleDownloadProgress
  });

  entities[name].elements.input.addEventListener("input", handleInputEvent);
  entities[name].elements.input.addEventListener(
    /**
     * Handle non-input keypresses for the input field, e.g. arrow keys.
     * (keypress event doesn't work here)
     */
    "keydown",
    handleKeyDownEvent
  );
}

export default {
  register
};
