import { useEffect, useRef } from 'react';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';

const CONTAINER_STYLE = { width: '100%', height: '220px', borderRadius: '8px' };
const FALLBACK_CENTER = { lat: 41.9028, lng: 12.4964 };

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  gestureHandling: 'cooperative',
  styles: [
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  ],
};

interface Props {
  lat: number | null;
  lng: number | null;
  radiusM: number;
}

export function BranchMapPreview({ lat, lng, radiusM }: Props) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3 text-xs text-neutral-500">
        Anteprima mappa non disponibile — <code>VITE_GOOGLE_MAPS_API_KEY</code> non configurata.
      </div>
    );
  }
  return <MapInner apiKey={apiKey} lat={lat} lng={lng} radiusM={radiusM} />;
}

function MapInner({
  apiKey,
  lat,
  lng,
  radiusM,
}: {
  apiKey: string;
  lat: number | null;
  lng: number | null;
  radiusM: number;
}) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);

  useEffect(() => {
    return () => {
      circleRef.current?.setMap(null);
      circleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lat === null || lng === null) {
      circleRef.current?.setMap(null);
      circleRef.current = null;
      return;
    }
    const center = { lat, lng };
    if (!circleRef.current) {
      circleRef.current = new google.maps.Circle({
        map,
        center,
        radius: radiusM,
        strokeColor: '#0b416e',
        strokeOpacity: 0.7,
        strokeWeight: 1,
        fillColor: '#0b416e',
        fillOpacity: 0.12,
      });
    } else {
      circleRef.current.setCenter(center);
      circleRef.current.setRadius(radiusM);
    }
    const bounds = circleRef.current.getBounds();
    if (bounds) map.fitBounds(bounds, 24);
  }, [lat, lng, radiusM, isLoaded]);

  if (loadError) {
    return (
      <div className="rounded-md border border-[color:var(--color-error)] bg-red-50 p-3 text-xs text-[color:var(--color-error)]">
        Errore nel caricamento della mappa.
      </div>
    );
  }
  if (!isLoaded) {
    return (
      <div className="rounded-md bg-neutral-100 p-3 text-xs text-neutral-500" style={{ height: 220 }}>
        Caricamento mappa…
      </div>
    );
  }
  const hasCoords = lat !== null && lng !== null;
  return (
    <GoogleMap
      mapContainerStyle={CONTAINER_STYLE}
      center={hasCoords ? { lat, lng } : FALLBACK_CENTER}
      zoom={hasCoords ? 15 : 5}
      options={MAP_OPTIONS}
      onLoad={(m) => {
        mapRef.current = m;
      }}
      onUnmount={() => {
        mapRef.current = null;
      }}
    >
      {hasCoords && <Marker position={{ lat, lng }} />}
    </GoogleMap>
  );
}
