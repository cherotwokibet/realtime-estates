'use client';

import { useEffect, useRef, useState } from 'react';
import {
  moveSearchAreaPolygonVertex,
  searchAreaPolygonText,
  searchAreaPolygonVerticesFromText,
  undoSearchAreaMapPoint,
} from '../lib/search-area-editor.ts';

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export default function SearchAreaMapEditor({
  tileUrl,
  textareaId,
}: {
  tileUrl: string;
  textareaId: string;
}) {
  const mapElement = useRef<HTMLDivElement>(null);
  const actions = useRef<{
    start: () => void;
    finish: () => void;
    undo: () => void;
    cancel: () => void;
    clear: () => void;
  } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [vertexCount, setVertexCount] = useState(0);
  const [hasPolygon, setHasPolygon] = useState(false);
  const [status, setStatus] = useState('');
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let map: import('leaflet').Map | undefined;
    let layers: import('leaflet').LayerGroup | undefined;
    let drawingPolygon = false;
    let vertices: [number, number][] = [];
    let textArea: HTMLTextAreaElement | null = null;
    let onTextInput: (() => void) | undefined;

    const setAreaText = (value: string) => {
      if (!textArea) return;
      textArea.value = value;
      textArea.dispatchEvent(new Event('input', { bubbles: true }));
      textArea.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const redraw = (leaflet: typeof import('leaflet')) => {
      if (!map || !layers) return;
      layers.clearLayers();
      const positions = vertices.map(([longitude, latitude]): [number, number] => [
        latitude,
        longitude,
      ]);
      if (positions.length >= 3) {
        leaflet
          .polygon(positions, { color: '#165b50', fillColor: '#56ad92', fillOpacity: 0.2 })
          .addTo(layers);
      } else if (positions.length > 1) {
        leaflet.polyline(positions, { color: '#165b50', dashArray: '6 6' }).addTo(layers);
      }
      if (!drawingPolygon) {
        positions.forEach((position, index) => {
          leaflet
            .marker(position, {
              draggable: true,
              keyboard: true,
              title: `Move boundary point ${index + 1}`,
              icon: leaflet.divIcon({
                className: 'search-area-map__vertex',
                iconSize: [18, 18],
                iconAnchor: [9, 9],
              }),
            })
            .on('dragend', (event: import('leaflet').DragEndEvent) => {
              const point = event.target.getLatLng();
              const moved = moveSearchAreaPolygonVertex(vertices, index, [point.lng, point.lat]);
              const value = moved ? searchAreaPolygonText(moved) : null;
              if (moved && value) {
                vertices = moved;
                setAreaText(value);
              } else {
                redraw(leaflet);
                setStatus(
                  'That move would make the area invalid, so the previous boundary was restored.',
                );
              }
            })
            .addTo(layers!);
        });
      }
    };

    const restoreTextArea = (leaflet: typeof import('leaflet')) => {
      const restored = textArea ? searchAreaPolygonVerticesFromText(textArea.value) : null;
      if (!restored) {
        vertices = [];
        layers?.clearLayers();
        setHasPolygon(false);
        if (textArea?.value)
          setStatus('The text is not a valid search polygon. Correct it in the GeoJSON field.');
        return;
      }
      vertices = restored;
      setHasPolygon(true);
      redraw(leaflet);
    };

    const initialize = async () => {
      try {
        const leaflet = await import('leaflet');
        if (disposed || !mapElement.current) return;
        textArea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
        if (!textArea) return;
        map = leaflet.map(mapElement.current, {
          scrollWheelZoom: false,
          boxZoom: false,
          keyboard: true,
        });
        map.setView([-0.5, 37.8], 6);
        leaflet
          .tileLayer(tileUrl, {
            attribution: OSM_ATTRIBUTION,
            maxZoom: 19,
            updateWhenIdle: true,
            keepBuffer: 0,
          })
          .on('tileerror', () => setTileError(true))
          .addTo(map);
        layers = leaflet.layerGroup().addTo(map);
        map.on('click', (event: import('leaflet').LeafletMouseEvent) => {
          if (!drawingPolygon) return;
          if (vertices.length >= 100) {
            setStatus(
              'The area can have at most 100 boundary edges. Finish or cancel this drawing.',
            );
            return;
          }
          vertices.push([event.latlng.lng, event.latlng.lat]);
          setVertexCount(vertices.length);
          redraw(leaflet);
          setStatus(`${vertices.length} boundary point${vertices.length === 1 ? '' : 's'} added.`);
        });
        onTextInput = () => restoreTextArea(leaflet);
        textArea.addEventListener('input', onTextInput);
        restoreTextArea(leaflet);
        actions.current = {
          start: () => {
            drawingPolygon = true;
            vertices = [];
            setVertexCount(0);
            setDrawing(true);
            layers?.clearLayers();
            setStatus('Select at least three points on the map, then finish the boundary.');
          },
          finish: () => {
            const value = searchAreaPolygonText(vertices);
            if (!value) {
              setStatus('Add at least three distinct points that form a valid closed boundary.');
              return;
            }
            drawingPolygon = false;
            setDrawing(false);
            setAreaText(value);
            setStatus(
              'Search area set. Drag a point to adjust the boundary, or edit GeoJSON by keyboard.',
            );
          },
          undo: () => {
            vertices = undoSearchAreaMapPoint(vertices);
            setVertexCount(vertices.length);
            redraw(leaflet);
            setStatus(
              vertices.length
                ? `Last point removed. ${vertices.length} point${vertices.length === 1 ? '' : 's'} remain.`
                : 'Last point removed. Add at least three points to finish the boundary.',
            );
          },
          cancel: () => {
            drawingPolygon = false;
            setDrawing(false);
            setVertexCount(0);
            restoreTextArea(leaflet);
            setStatus('Drawing cancelled; the previous GeoJSON value was kept.');
          },
          clear: () => {
            drawingPolygon = false;
            setDrawing(false);
            vertices = [];
            setVertexCount(0);
            setHasPolygon(false);
            layers?.clearLayers();
            setAreaText('');
            setStatus('Search area cleared. Other search filters were not changed.');
          },
        };
      } catch {
        if (!disposed)
          setStatus(
            'The interactive map could not be loaded. You can still edit the GeoJSON field.',
          );
      }
    };

    void initialize();
    return () => {
      disposed = true;
      if (textArea && onTextInput) textArea.removeEventListener('input', onTextInput);
      actions.current = null;
      map?.remove();
    };
  }, [textareaId, tileUrl]);

  return (
    <section className="search-area-map-editor" aria-labelledby="search-area-map-title">
      <h3 id="search-area-map-title">Draw or adjust the search area</h3>
      <p>
        Map tiles load only for the visible area. You can use the GeoJSON field by keyboard if you
        prefer. Moving the map shows only approximate search boundaries, not exact property
        locations.
      </p>
      {tileError && (
        <p className="search-area-map-editor__warning" role="status">
          Map tiles could not be loaded. The GeoJSON field remains available.
        </p>
      )}
      <div className="search-area-map-editor__controls">
        {!drawing ? (
          <button type="button" onClick={() => actions.current?.start()}>
            Start a new boundary
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => actions.current?.finish()}
              disabled={vertexCount < 3}
            >
              Finish boundary
            </button>
            <button
              type="button"
              onClick={() => actions.current?.undo()}
              disabled={vertexCount === 0}
            >
              Undo last point
            </button>
            <button type="button" onClick={() => actions.current?.cancel()}>
              Cancel drawing
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => actions.current?.clear()}
          disabled={!hasPolygon && !drawing}
        >
          Clear area
        </button>
      </div>
      <div
        ref={mapElement}
        className="search-area-map-editor__map"
        role="region"
        aria-label="Map for drawing a search boundary"
      />
      <p className="search-area-map-editor__attribution">
        Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>.
      </p>
      <p className="search-area-map-editor__status" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
