import React, { useEffect, useState, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import './App.css';
import { GeoSearchControl, OpenStreetMapProvider } from 'leaflet-geosearch';
import 'leaflet-geosearch/dist/geosearch.css';
import * as tf from '@tensorflow/tfjs';
import LoadingSpinner from './LoadingSpinner';
import 'tippy.js/dist/tippy.css';
import tippy from 'tippy.js';
import 'leaflet.heat';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'react-toastify/dist/ReactToastify.css';
import { toast, ToastContainer } from 'react-toastify';
import tokml from 'tokml'; // KML export library
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCA-lQY52UJnxyj1wDCQf1yEGcYGfRgedw",
  authDomain: "terraseg-bc7bc.firebaseapp.com",
  projectId: "terraseg-bc7bc",
  storageBucket: "terraseg-bc7bc.appspot.com",
  messagingSenderId: "248270192038",
  appId: "1:248270192038:web:60281989c612b880c9e367"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore(app);

function App() {
  const mapRef = useRef();
  const markers = useRef(L.markerClusterGroup());
  const heatmapLayer = useRef(L.heatLayer([]));
  const [markerList, setMarkerList] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('default');
  const [selectedWMSLayer, setSelectedWMSLayer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [model, setModel] = useState(null);
  const [segmentationLayer, setSegmentationLayer] = useState(L.layerGroup());
  const [wsConnected, setWsConnected] = useState(false);
  const drawnItems = useRef(L.featureGroup());
  const socket = useRef(null);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [modelUrl, setModelUrl] = useState('https://path/to/your/model.json'); // Model URL can be updated dynamically

  const categories = {
    default: { iconUrl: 'https://img.icons8.com/ios-filled/50/ff0000/marker.png', title: 'Default Marker' },
    park: { iconUrl: 'https://img.icons8.com/ios-filled/50/00ff00/marker.png', title: 'Park' },
    restaurant: { iconUrl: 'https://img.icons8.com/ios-filled/50/0000ff/marker.png', title: 'Restaurant' },
    historical: { iconUrl: 'https://img.icons8.com/ios-filled/50/ffff00/marker.png', title: 'Historical Site' },
  };

  const wmsLayers = [
    { name: "MODIS True Color", url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?layers=MODIS_Terra_Corrected_Radiance_True_Color&bbox={bbox}&width=256&height=256&format=image/png&transparent=true' },
    { name: "Building Blocks", url: 'https://example.com/wms?service=WMS&version=1.1.1&request=GetMap&layers=buildings&bbox={bbox}&width=256&height=256&srs=EPSG:4326&format=image/png' },
  ];

  useEffect(() => {
    // Initialize Map and Layers
    mapRef.current = L.map('map').setView([40.7128, -74.0060], 3);
    const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(mapRef.current);
    const satelliteLayer = L.tileLayer('https://{s}.satellite.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' });
    const terrainLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' });

    markers.current.addTo(mapRef.current);
    mapRef.current.addControl(new GeoSearchControl({ provider: new OpenStreetMapProvider(), style: 'bar', autoClose: true, keepResult: true }));
    L.control.layers({ "Street": streetLayer, "Satellite": satelliteLayer, "Terrain": terrainLayer }).addTo(mapRef.current);
    mapRef.current.addLayer(segmentationLayer);
    heatmapLayer.current.addTo(mapRef.current);

    const drawControl = new L.Control.Draw({
      edit: { featureGroup: drawnItems.current },
      draw: { polygon: true, circle: true, rectangle: true }
    });
    mapRef.current.addControl(drawControl);
    mapRef.current.addLayer(drawnItems.current);

    // WebSocket with reconnection logic
    const initWebSocket = () => {
      socket.current = new WebSocket('wss://your-websocket-url');

      socket.current.onopen = () => {
        setWsConnected(true);
        console.log('WebSocket connected');
      };

      socket.current.onclose = () => {
        setWsConnected(false);
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(initWebSocket, 5000);
      };

      socket.current.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'marker') {
          addMarkerToMap(data.latlng, data.title, data.category);
          notify(`New marker added: ${data.title}`);
        }
        if (data.type === 'segmentation' && model) {
          const segmentationMask = await model.predict(tf.tensor(data.segmentationInput)).data();
          visualizeSegmentation(segmentationMask);
          notify('New segmentation data received');
        }
      };
    };
    initWebSocket();

    // Tooltips
    tippy('.tooltip', { content: (reference) => reference.getAttribute('data-title') });

    // Draw Event
    mapRef.current.on(L.Draw.Event.CREATED, (event) => {
      const layer = event.layer;
      drawnItems.current.addLayer(layer);
    });

    // Firebase authentication listener
    onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        setUser(null);
      }
    });

    return () => {
      mapRef.current.remove();
      socket.current.close(); // Clean up socket connection on unmount
    };
  }, [model]);

  const loadModel = async () => {
    setLoading(true);
    setError(null);
    try {
      const loadedModel = await tf.loadGraphModel(modelUrl);
      setModel(loadedModel);
    } catch (err) {
      setError("Failed to load the model.");
    } finally {
      setLoading(false);
    }
  };

  const fetchWMSImage = (layer) => {
    if (selectedWMSLayer) {
      mapRef.current.eachLayer(function (l) {
        if (l._url && l._url.includes('wms')) {
          mapRef.current.removeLayer(l);
        }
      });
    }
    const bounds = mapRef.current.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',');
    const imageLayer = L.tileLayer(layer.url.replace('{bbox}', bbox), { attribution: '&copy; WMS layer' }).addTo(mapRef.current);
    return imageLayer;
  };

  const handleWMSLayerChange = (e) => {
    const selectedLayer = wmsLayers.find(layer => layer.name === e.target.value);
    setSelectedWMSLayer(selectedLayer.url);
    fetchWMSImage(selectedLayer);
  };

  const clearMarkers = () => {
    markers.current.clearLayers();
    heatmapLayer.current.setLatLngs([]);
    setMarkerList([]);
  };

  const addMarkerToMap = (latlng, title, category) => {
    const marker = L.marker(latlng, {
      icon: L.icon({ iconUrl: categories[category]?.iconUrl, iconSize: [32, 32], iconAnchor: [16, 32] }),
    }).bindPopup(title);
    markers.current.addLayer(marker);
    setMarkerList(prev => [...prev, { title, category, lat: latlng.lat, lng: latlng.lng }]);
  };

  const exportGeoJSON = () => {
    const geoJSON = markers.current.toGeoJSON();
    const geoJSONStr = JSON.stringify(geoJSON);
    const blob = new Blob([geoJSONStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'markers.geojson';
    a.click();
  };

  const exportKML = () => {
    const geoJSON = markers.current.toGeoJSON();
    const kmlStr = tokml(geoJSON);
    const blob = new Blob([kmlStr], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'markers.kml';
    a.click();
  };

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const notify = (message) => {
    toast(message, { position: 'top-right', autoClose: 3000, type: 'info' });
  };

  return (
    <div className="App">
      <ToastContainer />
      <div id="map"></div>
      <div className="controls">
        {user ? (
          <div>
            <button onClick={handleLogout}>Log out</button>
            <div>Welcome, {user.email}</div>
          </div>
        ) : (
          <div>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button onClick={handleLogin}>Log in</button>
          </div>
        )}

        <button onClick={clearMarkers}>Clear Markers</button>
        <select onChange={handleWMSLayerChange}>
          <option value="">Select WMS Layer</option>
          {wmsLayers.map(layer => (
            <option key={layer.name} value={layer.name}>{layer.name}</option>
          ))}
        </select>

        <button onClick={exportGeoJSON}>Export GeoJSON</button>
        <button onClick={exportKML}>Export KML</button>
        <button onClick={loadModel}>Load Segmentation Model</button>
        {loading && <LoadingSpinner />}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

export default App;
