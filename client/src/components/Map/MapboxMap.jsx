import React, { useRef, useEffect, useState, useContext } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDirections from '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions';
import '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import axios from 'axios';
import { io } from 'socket.io-client';
import ngeohash from 'ngeohash';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { Activity, Route, Map as MapIcon } from 'lucide-react';
import { getSocketURL, getSocketOptions } from '../../services/socketConfig';
import RunTracker from '../RunTracker';
import IntervalTimer from '../IntervalTimer';
import UserProfileModal from '../Chat/UserProfileModal';
import './Map.css';
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_API_KEY;

// Create arrow marker element for running
const createArrowMarker = (rotation = 0) => {
  const el = document.createElement('div');
  el.style.width = '40px';
  el.style.height = '40px';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.transformOrigin = 'center center';
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="#4285F4" stroke="white" stroke-width="1.5" style="transform-origin: center center; transition: transform 0.1s linear; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));"><polygon points="12,2 22,22 12,16 2,22"/></svg>`;
  el.style.cursor = 'pointer';
  el.dataset.rotation = rotation;

  // Set initial rotation on the SVG
  const svg = el.querySelector('svg');
  if (svg) {
    svg.style.transform = `rotate(${rotation}deg)`;
  }

  return el;
};

// Create normal marker element for stopped
const createNormalMarker = () => {
  const el = document.createElement('div');
  el.style.width = '30px';
  el.style.height = '30px';
  el.style.backgroundColor = '#4285F4';
  el.style.borderRadius = '50%';
  el.style.border = '3px solid white';
  el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
  el.style.cursor = 'pointer';
  return el;
};

const MapboxMap = () => {
  const { user } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();
  const mapContainer = useRef(null);
  const map = useRef(null);
  const socket = useRef(null);
  const watchId = useRef(null);
  const userMarker = useRef(null);
  const startMarker = useRef(null);
  const userHeading = useRef(0);
  const currentDirection = useRef(null);
  const previousHeading = useRef(null);
  const startTime = useRef(null);
  const isFollowingUserRef = useRef(true); // Ref to use inside watchPosition callback
  const [tiles, setTiles] = useState([]);
  const [showTracker, setShowTracker] = useState(false);
  const [showIntervals, setShowIntervals] = useState(false);
  const [isRunActive, setIsRunActive] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [center, setCenter] = useState([0, 0]);
  const directionsControl = useRef(null);
  const currentStyle = useRef('mapbox://styles/mapbox/dark-v11');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDesktopMenuOpen, setIsDesktopMenuOpen] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  const [originInput, setOriginInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [routeGeoJSON, setRouteGeoJSON] = useState(null);

  const [showDirectionsPanel, setShowDirectionsPanel] = useState(false);
  const [directionsData, setDirectionsData] = useState(null);
  const [selectedMode, setSelectedMode] = useState('driving');
  const [showTiles, setShowTiles] = useState(true);
  const showTilesRef = useRef(true); // Ref to access current value in socket handlers
  
  // Keep ref in sync with state
  useEffect(() => {
    showTilesRef.current = showTiles;
  }, [showTiles]);

  // Toggle directions panel
  const toggleDirectionsPanel = () => {
    setShowDirectionsPanel(!showDirectionsPanel);
  };

  // Toggle tiles visibility
  const toggleTiles = () => {
    const newShowTiles = !showTiles;
    setShowTiles(newShowTiles);
    if (map.current) {
      const visibility = newShowTiles ? 'visible' : 'none';
      if (map.current.getLayer('tiles-layer')) {
        map.current.setLayoutProperty('tiles-layer', 'visibility', visibility);
      }
      if (map.current.getLayer('territories-layer')) {
        map.current.setLayoutProperty('territories-layer', 'visibility', visibility);
      }
      if (map.current.getLayer('territories-outline')) {
        map.current.setLayoutProperty('territories-outline', 'visibility', visibility);
      }
    }
  };

  // Calculate route with directions data
  const calculateRoute = async (mode = selectedMode) => {
    if (!originInput.trim() || !destinationInput.trim()) return;
    
    try {
      // Geocode origin and destination (same as before)
      const originRes = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(originInput)}.json?access_token=${mapboxgl.accessToken}&limit=1`);
      const originData = await originRes.json();
      
      const destRes = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(destinationInput)}.json?access_token=${mapboxgl.accessToken}&limit=1`);
      const destData = await destRes.json();
      
      if (!originData.features.length || !destData.features.length) {
        alert('Could not find one or both locations');
        return;
      }
      
      const origin = originData.features[0].center;
      const destination = destData.features[0].center;
      
      // Get directions with steps
      const directionsRes = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${mode}/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?geometries=geojson&steps=true&access_token=${mapboxgl.accessToken}`);
      const directionsData = await directionsRes.json();
      
      if (directionsData.routes && directionsData.routes.length > 0) {
        const route = directionsData.routes[0];
        const routeGeometry = route.geometry;
        
        setDirectionsData({
          distance: (route.distance / 1000).toFixed(2), // km
          duration: Math.round(route.duration / 60), // minutes
          steps: route.legs[0].steps.map(step => ({
            instruction: step.maneuver.instruction,
            distance: (step.distance / 1000).toFixed(2),
            duration: Math.round(step.duration / 60)
          }))
        });
        
        setRouteGeoJSON({
          type: 'Feature',
          properties: {},
          geometry: routeGeometry
        });
        
        // Draw route on map (same as before)
        if (map.current) {
          if (map.current.getLayer('custom-route-line')) {
            map.current.removeLayer('custom-route-line');
          }
          if (map.current.getSource('custom-route')) {
            map.current.removeSource('custom-route');
          }
          
          map.current.addSource('custom-route', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: routeGeometry
            }
          });
          
          map.current.addLayer({
            id: 'custom-route-line',
            type: 'line',
            source: 'custom-route',
            layout: {
              'line-join': 'round',
              'line-cap': 'round'
            },
            paint: {
              'line-color': '#3b82f6',
              'line-width': 4,
              'line-opacity': 0.8
            }
          });
          
          const coordinates = routeGeometry.coordinates;
          const bounds = coordinates.reduce((bounds, coord) => {
            return bounds.extend(coord);
          }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
          
          map.current.fitBounds(bounds, {
            padding: 50,
            duration: 1000
          });
        }
        
        setShowDirectionsPanel(true); // Auto-show panel when route is calculated
      }
    } catch (error) {
      console.error('Error calculating route:', error);
      alert('Failed to calculate route');
    }
  };
  
  // Show current location
  const showCurrentLocation = () => {
    if (currentLocation && map.current) {
      map.current.flyTo({
        center: currentLocation,
        zoom: 16,
        duration: 1000
      });
      
      // Add or update location marker
      if (userMarker.current) {
        userMarker.current.setLngLat(currentLocation);
      } else {
        userMarker.current = new mapboxgl.Marker({ color: '#3b82f6' })
          .setLngLat(currentLocation)
          .addTo(map.current);
      }
      
      alert(`📍 Current Location: ${currentLocation[1].toFixed(6)}, ${currentLocation[0].toFixed(6)}`);
    } else {
      // Try to get fresh location
      setLocationLoading(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = [position.coords.longitude, position.coords.latitude];
          setCurrentLocation(coords);
          setLocationLoading(false);
          
          if (map.current) {
            map.current.flyTo({
              center: coords,
              zoom: 16,
              duration: 1000
            });
            
            if (userMarker.current) {
              userMarker.current.setLngLat(coords);
            } else {
              userMarker.current = new mapboxgl.Marker({ color: '#3b82f6' })
                .setLngLat(coords)
                .addTo(map.current);
            }
          }
          
          alert(`📍 Current Location: ${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}`);
        },
        (error) => {
          setLocationLoading(false);
          let errorMessage = 'Unable to get your location.';
          if (error.code === 1) {
            errorMessage = 'Location permission denied. Please enable location in settings.';
          } else if (error.code === 2) {
            errorMessage = 'Location service unavailable. Please check your device settings.';
          } else if (error.code === 3) {
            errorMessage = 'Location request timed out. Please try again.';
          }
          alert(errorMessage);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000
        }
      );
    }
  };
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const otherMarkers = useRef({});
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [mapStyleMode, setMapStyleMode] = useState(0); // 0: Dark, 1: Satellite, 2: Streets+Heatmap
  const [selectedUser, setSelectedUser] = useState(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const [isFollowingUser, setIsFollowingUser] = useState(true);
  
  // Run tracking state - lifted up to persist when panel is hidden
  const [isTracking, setIsTracking] = useState(false);
  const isTrackingRef = useRef(false);
  const [liveRoute, setLiveRoute] = useState([]);
  const [runStats, setRunStats] = useState({
    duration: 0,
    distance: 0,
    pace: 0,
    startTime: null
  });


  const [locationLoading, setLocationLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);

  useEffect(() => {
    isFollowingUserRef.current = isFollowingUser;
  }, [isFollowingUser]);

  useEffect(() => {
    if (map.current && currentLocation && isFollowingUser && isRunActive) {
      map.current.flyTo({
        center: currentLocation,
        zoom: 16,
        duration: 1000
      });
    }
  }, [currentLocation, isFollowingUser, isRunActive]);

  useEffect(() => {
    if (map.current) return;

    setLocationLoading(true);
    
    // Try to get saved location from localStorage first
    const savedLocation = localStorage.getItem('lastKnownLocation');
    let initialCoords = null;
    
    if (savedLocation) {
      try {
        const parsed = JSON.parse(savedLocation);
        const savedTime = parsed.timestamp || 0;
        const currentTime = Date.now();
        const age = currentTime - savedTime;
        
        // Use saved location if it's less than 24 hours old
        if (age < 24 * 60 * 60 * 1000 && parsed.coords) {
          initialCoords = parsed.coords;
          console.log('📍 Using saved location from localStorage:', initialCoords);
          setCenter(initialCoords);
          setCurrentLocation(initialCoords);
          initializeMap(initialCoords);
          setLocationLoading(false);
        }
      } catch (e) {
        console.warn('Failed to parse saved location:', e);
      }
    }
    
    // Always try to get fresh location for accuracy
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = [position.coords.longitude, position.coords.latitude];
        const accuracy = position.coords.accuracy;
        
        console.log('📍 Fresh location obtained:', coords, 'Accuracy:', accuracy, 'meters');
        
        // Save to localStorage for next session
        localStorage.setItem('lastKnownLocation', JSON.stringify({
          coords: coords,
          timestamp: Date.now(),
          accuracy: accuracy
        }));
        
        // Only update if accuracy is good (< 100m) or we don't have an initial position
        if (accuracy < 100 || !initialCoords) {
          setCenter(coords);
          setCurrentLocation(coords);
          
          // If map already initialized with saved location, update it
          if (map.current && initialCoords) {
            // Calculate distance between saved and new location
            const distance = calculateDistance(initialCoords[1], initialCoords[0], coords[1], coords[0]);
            console.log('📏 Distance from saved location:', distance.toFixed(2), 'km');
            
            // Only jump if significant difference (> 100m)
            if (distance > 0.1) {
              console.log('🔄 Location changed significantly, updating map');
              map.current.flyTo({
                center: coords,
                zoom: 15,
                duration: 1500
              });
              if (userMarker.current) {
                userMarker.current.setLngLat(coords);
              }
            }
          } else if (!initialCoords) {
            // No saved location, use fresh location
            initializeMap(coords);
          }
        } else {
          console.log('⚠️ Low accuracy location ignored (>100m)');
        }
        
        setLocationLoading(false);
      },
      (error) => {
        let errorMessage = 'GPS unavailable. Using default location.';
        if (error.code === 1) {
          errorMessage = 'Location permission denied. Using default location.';
        } else if (error.code === 2) {
          errorMessage = 'Location unavailable. Using default location.';
        } else if (error.code === 3) {
          errorMessage = 'Location request timeout. Using default location.';
        }
        console.warn('Geolocation error:', errorMessage, error.message);
        setLocationLoading(false);
        setLocationError(errorMessage);
        
        // Only use fallback if we don't have a saved location
        if (!initialCoords) {
          const fallback = [55.2708, 25.2048];
          setCenter(fallback);
          setCurrentLocation(fallback);
          initializeMap(fallback);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000, // 15 second timeout
        maximumAge: 60000 // Accept cached location up to 1 minute old
      }
    );
  }, []);

  const initializeMap = (coords) => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: coords,
      zoom: 15
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.current.on('dragstart', () => setIsFollowingUser(false));
    map.current.on('zoomstart', () => setIsFollowingUser(false));
    map.current.on('touchstart', () => setIsFollowingUser(false));

    map.current.on('load', () => {
      fetchTiles();
      startLocationTracking();
      setupMapLayers();
      
      // Fetch nearby runners when map moves (with debounce)
      let moveTimeout;
      map.current.on('moveend', () => {
        clearTimeout(moveTimeout);
        moveTimeout = setTimeout(() => {
          fetchNearbyRunners();
        }, 500); // Debounce for 500ms
      });
    });
  };

  const setupMapLayers = () => {
    if (!map.current) return;

    // Add source for live route drawing
    map.current.addSource('live-route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: []
        }
      }
    });

    map.current.addLayer({
      id: 'live-route-layer',
      type: 'line',
      source: 'live-route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#ef4444',
        'line-width': 5,
        'line-opacity': 0.8
      }
    });

    // Add source for heatmap
    map.current.addSource('heatmap', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.current.addLayer({
      id: 'heatmap-layer',
      type: 'heatmap',
      source: 'heatmap',
      maxzoom: 15,
      layout: { visibility: showHeatmap ? 'visible' : 'none' },
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'intensity'], 0, 0, 10, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(33,102,172,0)',
          0.2, 'rgb(103,169,207)',
          0.4, 'rgb(209,229,240)',
          0.6, 'rgb(253,219,199)',
          0.8, 'rgb(239,138,98)',
          1, 'rgb(178,24,43)'
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 15, 20],
        'heatmap-opacity': 0.6
      }
    });
  };

  const getDirection = (heading) => {
    if (heading >= 337.5 || heading < 22.5) return 'N';
    if (heading >= 22.5 && heading < 67.5) return 'NE';
    if (heading >= 67.5 && heading < 112.5) return 'E';
    if (heading >= 112.5 && heading < 157.5) return 'SE';
    if (heading >= 157.5 && heading < 202.5) return 'S';
    if (heading >= 202.5 && heading < 247.5) return 'SW';
    if (heading >= 247.5 && heading < 292.5) return 'W';
    if (heading >= 292.5 && heading < 337.5) return 'NW';
    return 'N';
  };

  // Calculate heading/bearing between two points [lng, lat]
  const calculateHeading = (from, to) => {
    const [lng1, lat1] = from;
    const [lng2, lat2] = to;
    
    const toRad = (deg) => deg * Math.PI / 180;
    const toDeg = (rad) => rad * 180 / Math.PI;
    
    const dLng = toRad(lng2 - lng1);
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);
    
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    
    let bearing = toDeg(Math.atan2(y, x));
    bearing = (bearing + 360) % 360; // Normalize to 0-360
    
    return bearing;
  };

  // Calculate distance between two coordinates in km (Haversine formula)
  const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const toRad = (deg) => deg * Math.PI / 180;
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

    const reconnectSocket = () => {
      if (socket.current) {
        socket.current.connect();
        setIsSocketConnected(true);
        console.log('🔄 Manual socket reconnection attempted');
      }
    };

    const startLocationTracking = () => {

    const socketUrl = getSocketURL();
    socket.current = io(socketUrl, getSocketOptions());
    
    // Multiplayer events
    socket.current.on('connect', () => {
      console.log('Socket connected:', socket.current.connected);
      setIsSocketConnected(true);
      if (user) {
        socket.current.emit('authenticate', { userId: user.id, username: user.username });
        // Fetch online users count
        setTimeout(() => {
          socket.current.emit('get-online-users');
          fetchNearbyRunners();
        }, 500);
        // Sync any pending offline runs
        syncPendingRuns();
      }
    });

    socket.current.on('online-users-list', (data) => {
      console.log('🌐 Online users list received:', data.length, 'users');
      // Update online users count (exclude current user from the count)
      const otherUsers = data.filter(u => u.userId !== user?.id);
      setOnlineUsers(otherUsers);
      console.log('👥 Displaying:', otherUsers.length, '+ 1 (you) =', otherUsers.length + 1);
    });

    socket.current.on('user-connected', (data) => {
      console.log('🟢 User connected:', data.username);
      if (data.userId !== user?.id) {
        setOnlineUsers(prev => {
          if (!prev.find(u => u.userId === data.userId)) {
            const updated = [...prev, { userId: data.userId, username: data.username }];
            console.log('👥 Added connected user. Total:', updated.length);
            return updated;
          }
          return prev;
        });
      }
    });

    socket.current.on('user-disconnected', (data) => {
      console.log('🔴 User disconnected:', data.userId);
      setOnlineUsers(prev => {
        const updated = prev.filter(u => u.userId !== data.userId);
        console.log('👥 Removed disconnected user. Total:', updated.length);
        return updated;
      });
    });

    socket.current.on('disconnect', () => {
      console.log('Socket disconnected:', socket.current.connected);
      setIsSocketConnected(false);
    });

    socket.current.on('connect_error', (error) => {
      // Suppress "Invalid namespace" errors - these are non-critical
      if (error.message && error.message.includes('Invalid namespace')) {
        console.warn('⚠️ Socket namespace warning (non-critical):', error.message);
        return;
      }
      console.error('Socket connection error:', error.message);
      setIsSocketConnected(false);
    });

    socket.current.on('runner-started', (data) => {
      console.log('🏃 Runner started:', data.username, data.userId);
      updateOtherUserMarker({
        userId: data.userId,
        location: { lat: data.position.lat, lng: data.position.lng },
        username: data.username
      });
      // Add to online users if not already there
      setOnlineUsers(prev => {
        if (!prev.find(u => u.userId === data.userId)) {
          const updated = [...prev, data];
          console.log('👥 Added runner to online list. Total:', updated.length);
          return updated;
        }
        return prev;
      });
    });

    socket.current.on('runner-position-update', (data) => {
      updateOtherUserMarker({
        userId: data.userId,
        location: { lat: data.position.lat, lng: data.position.lng },
        username: data.username
      });
      
      // Update online users list
      setOnlineUsers(prev => {
        const existing = prev.find(u => u.userId === data.userId);
        if (!existing) {
          return [...prev, { userId: data.userId, username: data.username }];
        }
        return prev;
      });
    });

    socket.current.on('nearby-runners', (data) => {
      console.log('📍 Received nearby runners:', data.length, data.map(r => ({ id: r.userId, name: r.username })));
      
      // Clear existing markers and add all nearby runners
      const oldMarkersCount = Object.keys(otherMarkers.current).length;
      console.log('🗑️ Clearing', oldMarkersCount, 'existing markers');
      Object.values(otherMarkers.current).forEach(marker => marker.remove());
      otherMarkers.current = {};
      
      // Add markers for all nearby runners
      console.log('🎨 Creating markers for', data.length, 'runners');
      data.forEach((runner, index) => {
        console.log(`  [${index}] Creating marker for ${runner.username} (${runner.userId}) at [${runner.position.lat}, ${runner.position.lng}]`);
        updateOtherUserMarker({
          userId: runner.userId,
          location: { lat: runner.position.lat, lng: runner.position.lng },
          username: runner.username
        });
      });
      
      const newMarkersCount = Object.keys(otherMarkers.current).length;
      console.log('✅ Total markers on map:', newMarkersCount);
      
      // Update online users count
      const newOnlineUsers = data.map(runner => ({
        userId: runner.userId,
        username: runner.username
      }));
      setOnlineUsers(newOnlineUsers);
      console.log(' Online users updated:', newOnlineUsers.length, '+ 1 (you) =', newOnlineUsers.length + 1);
    });

    socket.current.on('territory-updated', (data) => {
      console.log('Territory updated:', data);
      // Only refresh tiles if they are visible (use ref for current value)
      if (showTilesRef.current) {
        fetchTiles();
      }
      // Also refresh heatmap if visible
      if (showHeatmap) {
        fetchHeatmapData();
      }
    });

    socket.current.on('territory-stolen', (data) => {
      console.log('Territory stolen:', data);
      // Show notification to user
      if (data.defenderId === user?.id) {
        alert(`Your territory was stolen by ${data.attackerId}!`);
      }
      // Only refresh tiles if they are visible (use ref for current value)
      if (showTilesRef.current) {
        fetchTiles();
      }
      // Also refresh heatmap if visible
      if (showHeatmap) {
        fetchHeatmapData();
      }
    });

    socket.current.on('ai-safety-check', (data) => {
      const isSafe = window.confirm(data.message);
      socket.current.emit('ai-safety-response', { isSafe });
    });

    socket.current.on('sos-trigger', (data) => {
      triggerSOS();
    });

    socket.current.on('runner-stopped', (data) => {
      if (otherMarkers.current[data.userId]) {
        otherMarkers.current[data.userId].remove();
        delete otherMarkers.current[data.userId];
      }
      setOnlineUsers(prev => prev.filter(u => u.userId !== data.userId));
    });

    socket.current.on('active-run-restored', (data) => {
      // Logic to restore an active run if needed
    });

    socket.current.on('tile-captured', (data) => {
      // Only refresh tiles if they are visible (use ref for current value)
      if (showTilesRef.current) {
        fetchTiles();
      }
      // Also refresh heatmap if visible
      if (showHeatmap) {
        fetchHeatmapData();
      }
      // Optional: Show toast notification for new tile
    });

    // Listen for other users' tile captures
    socket.current.on('tile-captured-global', (data) => {
      console.log('🌍 Another user captured a tile:', data);
      // Only refresh tiles if they are visible (use ref for current value)
      if (showTilesRef.current) {
        fetchTiles();
      }
      // Also refresh heatmap if visible
      if (showHeatmap) {
        fetchHeatmapData();
      }
    });

    socket.current.on('achievements-unlocked', (achievements) => {
      // Optional: Show achievement notification
    });

    if (user) {
      socket.current.emit('authenticate', { userId: user.id });
    }

    // Create initial marker (normal marker when not tracking)
    const markerEl = createNormalMarker();
    userMarker.current = new mapboxgl.Marker(markerEl)
      .setLngLat(center)
      .addTo(map.current);

    if ('geolocation' in navigator) {
      watchId.current = navigator.geolocation.watchPosition(
        (position) => {
          const coords = [position.coords.longitude, position.coords.latitude];
          const heading = position.coords.heading;
          
          setCenter(coords);
          
          // Only update liveRoute if RunTracker is NOT being used
          // RunTracker will send route updates via onRouteUpdate callback
          if (isTrackingRef.current && !showTracker) {
            setLiveRoute(prev => {
              const newRoute = [...prev, coords];
              if (map.current?.getSource('live-route')) {
                map.current.getSource('live-route').setData({
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: newRoute
                  }
                });
              }
              return newRoute;
            });

            // Send real-time update to others - match server protocol
            socket.current?.emit('location-update', {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              speed: position.coords.speed,
              heading: position.coords.heading,
              accuracy: position.coords.accuracy,
              timestamp: position.timestamp,
              distance: runStats.distance,
              pace: runStats.pace
            });
          } else if (isTrackingRef.current && showTracker) {
            // When RunTracker is shown, just emit location update for other users
            socket.current?.emit('location-update', {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              speed: position.coords.speed,
              heading: position.coords.heading,
              accuracy: position.coords.accuracy,
              timestamp: position.timestamp,
              distance: runStats.distance,
              pace: runStats.pace
            });
          }
          
          if (heading !== null && heading !== undefined) {
            // Detect direction change
            if (previousHeading.current !== null) {
              const headingDiff = Math.abs(heading - previousHeading.current);
              if (headingDiff > 15) { // 15 degree threshold
                currentDirection.current = getDirection(heading);
              }
            } else {
              currentDirection.current = getDirection(heading);
            }
            
            previousHeading.current = heading;
            userHeading.current = heading;
          }
          
          if (userMarker.current) {
            userMarker.current.setLngLat(coords);
            
            // Update marker based on tracking state
            if (isTrackingRef.current) {
              // Calculate heading from movement if device heading is not available
              let displayHeading = userHeading.current;
              
              // If we have device heading, use it
              if (heading !== null && heading !== undefined) {
                displayHeading = heading;
                console.log('📍 Using device heading:', heading.toFixed(1) + '°');
              } else {
                // Otherwise calculate from last two points
                if (liveRoute.length >= 2) {
                  const lastPoint = liveRoute[liveRoute.length - 2];
                  const currentPoint = coords;
                  const calculatedHeading = calculateHeading(
                    [lastPoint[0], lastPoint[1]], // [lng, lat]
                    [currentPoint[0], currentPoint[1]]
                  );
                  displayHeading = calculatedHeading;
                  userHeading.current = calculatedHeading;
                  console.log('📍 Calculated heading from movement:', calculatedHeading.toFixed(1) + '°');
                }
              }
              
              // Update arrow rotation
              if (displayHeading !== null && displayHeading !== undefined) {
                const markerElement = userMarker.current.getElement();
                if (markerElement) {
                  const svgElement = markerElement.querySelector('svg');
                  if (svgElement) {
                    svgElement.style.transform = `rotate(${displayHeading}deg)`;
                    svgElement.style.transformOrigin = 'center center';
                    markerElement.dataset.rotation = displayHeading;
                  }
                }
              }
            }
          }
          
          // Update location states
          setCurrentLocation(coords);
          setCenter(coords);

          // ONLY flyTo if following is enabled
          if (map.current && isFollowingUserRef.current) {
            map.current.flyTo({ center: coords, duration: 1000 });
          }
          
          setLocationError(null);
        },
        (error) => {
          let errorMessage = 'Location service error';
          if (error.code === 1) {
            errorMessage = 'Location permission denied';
          } else if (error.code === 2) {
            errorMessage = 'Location service unavailable';
          } else if (error.code === 3) {
            errorMessage = 'Location request timeout';
          }
          console.warn('Watch position error:', errorMessage, error.message);
          setLocationError(errorMessage);
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
      );
    }
  };

  const updateOtherUserMarker = (data) => {
    const { userId, location, username } = data;
    if (!userId || !location) {
      console.warn('⚠️ updateOtherUserMarker called with invalid data:', { userId, location });
      return;
    }

    if (!otherMarkers.current[userId]) {
      console.log(`  ✨ Creating NEW marker for user ${userId} (${username})`);
      // Create new marker for this user
      const el = document.createElement('div');
      el.className = 'other-user-marker';
      el.style.backgroundColor = '#ef4444';
      el.style.width = '15px';
      el.style.height = '15px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid white';
      el.style.cursor = 'pointer';
      el.title = username || `User ${userId}`;

      const marker = new mapboxgl.Marker(el)
        .setLngLat([location.lng, location.lat])
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div style="padding: 8px; text-align: center;">
            <h3 style="margin: 0 0 8px 0; font-weight: bold;">${username || 'Runner'}</h3>
            <button 
              id="view-profile-${userId}" 
              style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;"
            >
              View Profile
            </button>
          </div>
        `))
        .addTo(map.current);
      
      // Add click event to marker element
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (userId !== user?.id) {
          setSelectedUser({ id: userId, username: username || `User ${userId}` });
          setIsProfileModalOpen(true);
        }
      });

      otherMarkers.current[userId] = marker;
      console.log(`  ✅ Marker created successfully. Total markers:`, Object.keys(otherMarkers.current).length);
    } else {
      // Update existing marker
      console.log(`  🔄 Updating EXISTING marker for user ${userId}`);
      otherMarkers.current[userId].setLngLat([location.lng, location.lat]);
    }
  };

  // Toggle heatmap visibility
  useEffect(() => {
    if (!map.current) return;
    
    // Check if map style is loaded before accessing layers
    if (!map.current.isStyleLoaded()) return;
    
    // Check if style is loaded and layer exists
    const hasLayer = map.current.getLayer('heatmap-layer');
    if (!hasLayer) return;

    if (showHeatmap) {
      map.current.setLayoutProperty('heatmap-layer', 'visibility', 'visible');
      fetchHeatmapData();
    } else {
      map.current.setLayoutProperty('heatmap-layer', 'visibility', 'none');
    }
  }, [showHeatmap]);

  // Auto-refresh heatmap every 30 seconds when visible
  useEffect(() => {
    if (!showHeatmap || !map.current) return;
    
    const interval = setInterval(() => {
      fetchHeatmapData();
    }, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, [showHeatmap]);

  // Auto-refresh tiles every 15 seconds (only when tiles are visible)
  useEffect(() => {
    const interval = setInterval(() => {
      // Use ref to check current state
      if (showTilesRef.current) {
        fetchTiles();
      }
    }, 15000); // Refresh every 15 seconds
    
    return () => clearInterval(interval);
  }, []); // Empty dependency array - ref always has current value

  // Auto-refresh nearby runners every 30 seconds
  useEffect(() => {
    if (!socket.current || !isSocketConnected) return;
    
    const interval = setInterval(() => {
      fetchNearbyRunners();
      // Also refresh online users count
      socket.current.emit('get-online-users');
    }, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, [isSocketConnected, center]);

  const fetchHeatmapData = async () => {
    try {
      if (!map.current) return;
      const bounds = map.current.getBounds();
      const token = localStorage.getItem('token');
      const res = await axios.get('/heatmap/bounds', {
        params: {
          minLat: bounds.getSouth(),
          minLng: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLng: bounds.getEast()
        },
        headers: { 'x-auth-token': token }
      });
      if (map.current.getSource('heatmap')) {
        map.current.getSource('heatmap').setData(res.data);
        console.log('Heatmap data updated successfully');
      }
    } catch (err) {
      console.error('Heatmap fetch error:', err.message);
    }
  };

  const toggleStyle = () => {
    if (!map.current) return;
    
    // Cycle through 3 modes: 0=Dark, 1=Satellite, 2=Streets+Heatmap
    const newMode = (mapStyleMode + 1) % 3;
    setMapStyleMode(newMode);
    
    let newStyle;
    switch(newMode) {
      case 0:
        newStyle = 'mapbox://styles/mapbox/dark-v11';
        setShowHeatmap(false);
        break;
      case 1:
        newStyle = 'mapbox://styles/mapbox/satellite-streets-v12';
        setShowHeatmap(false);
        break;
      case 2:
        newStyle = 'mapbox://styles/mapbox/streets-v12';
        setShowHeatmap(true);
        break;
      default:
        newStyle = 'mapbox://styles/mapbox/dark-v11';
    }
    
    currentStyle.current = newStyle;
    
    // Use setStyle with diff: false to avoid sprite update warnings
    map.current.setStyle(newStyle, { diff: false });
    
    // Wait for style to load before re-adding layers
    map.current.once('style.load', () => {
      setupMapLayers();
      fetchTiles();
      if (showHeatmap || newMode === 2) {
        fetchHeatmapData();
      }
    });
  };

  // Add/Remove Directions Control based on state
  useEffect(() => {
    if (!map.current) return;

    if (showDirections) {
      if (!directionsControl.current) {
        const directions = new MapboxDirections({
          accessToken: mapboxgl.accessToken,
          unit: 'metric',
          profile: 'mapbox/walking',
          controls: {
            inputs: true,
            instructions: true
          },
          flyTo: false,
          interactive: true,
          alternatives: true
        });

        // Override the _move method to prevent layer query errors
        const originalMove = directions._move;
        directions._move = function(e) {
          try {
            if (this._map && this._map.isStyleLoaded()) {
              const layers = this._map.getStyle().layers;
              const hasDirectionsLayers = layers.some(layer => 
                layer.id.includes('directions-route-line-alt') || 
                layer.id.includes('directions-origin-point')
              );
              if (hasDirectionsLayers) {
                originalMove.call(this, e);
              }
            }
          } catch (error) {
            // Silently ignore layer query errors
          }
        };
        
        // Override the _onSingleClick method to prevent layer query errors
        const originalOnSingleClick = directions._onSingleClick;
        directions._onSingleClick = function(e) {
          try {
            if (this._map && this._map.isStyleLoaded()) {
              const layers = this._map.getStyle().layers;
              const hasDirectionsLayers = layers.some(layer => 
                layer.id.includes('directions-origin-point')
              );
              if (hasDirectionsLayers) {
                originalOnSingleClick.call(this, e);
              }
            }
          } catch (error) {
            // Silently ignore layer query errors
          }
        };

        // Add double-click/tap handler to directions container using MutationObserver
        const waitForDirectionsContainer = () => {
          const directionsContainer = document.querySelector('.mapboxgl-ctrl-directions');
          if (directionsContainer) {
            console.log('Directions container found, adding double-click/tap handler');
            
            // Add double-click handler for desktop
            directionsContainer.addEventListener('dblclick', (e) => {
              console.log('Double-click detected on directions container!');
              e.preventDefault();
              e.stopPropagation();
              
              // Toggle the MapboxDirections' built-in instructions panel
              const instructionsPanel = document.querySelector('.mapbox-directions-instructions');
              if (instructionsPanel) {
                const isVisible = instructionsPanel.style.display !== 'none';
                instructionsPanel.style.display = isVisible ? 'none' : 'block';
                console.log('Toggling instructions panel to:', isVisible ? 'hidden' : 'visible');
              }
            }, true); // true = capture phase
            
            // Add double-tap handler for mobile
            let lastTapTime = 0;
            let tapCount = 0;
            
            directionsContainer.addEventListener('touchend', (e) => {
              const currentTime = new Date().getTime();
              const timeSinceLastTap = currentTime - lastTapTime;
              
              // Check if this is a double tap (within 300ms of last tap)
              if (timeSinceLastTap < 300 && tapCount === 1) {
                console.log('Double-tap detected on directions container!');
                e.preventDefault();
                e.stopPropagation();
                
                // Toggle the MapboxDirections' built-in instructions panel
                const instructionsPanel = document.querySelector('.mapbox-directions-instructions');
                if (instructionsPanel) {
                  const isVisible = instructionsPanel.style.display !== 'none';
                  instructionsPanel.style.display = isVisible ? 'none' : 'block';
                  console.log('Toggling instructions panel to:', isVisible ? 'hidden' : 'visible');
                }
                
                // Reset tap count
                tapCount = 0;
              } else {
                // First tap
                tapCount = 1;
                lastTapTime = currentTime;
              }
            }, { passive: false });

            // Add tooltip
            directionsContainer.title = 'Double-click/tap to hide/show turn-by-turn panel';
            directionsContainer.style.cursor = 'pointer';
            return true;
          }
          return false;
        };

        // Try immediately first
        if (!waitForDirectionsContainer()) {
          // If not found, use MutationObserver to wait for it
          const observer = new MutationObserver((mutations, obs) => {
            if (waitForDirectionsContainer()) {
              obs.disconnect();
              console.log('Double-click handler added via MutationObserver');
            }
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true
          });

          // Store observer for cleanup
          directions._mutationObserver = observer;
          
          // Timeout after 5 seconds
          setTimeout(() => {
            observer.disconnect();
            console.log('MutationObserver timeout - directions container not found');
          }, 5000);
        }

        map.current.addControl(directions, 'top-left');
        directionsControl.current = directions;

        // Auto-set origin to live location
        if (center[0] !== 0) {
          setTimeout(() => {
            if (directionsControl.current) {
              directionsControl.current.setOrigin(center);
            }
          }, 500);
        }
      }
    } else {
      if (directionsControl.current) {
        // Disconnect mutation observer
        if (directionsControl.current._mutationObserver) {
          directionsControl.current._mutationObserver.disconnect();
        }

        try {
          map.current.removeControl(directionsControl.current);
        } catch (e) {
          // Silently catch potential error if control is already gone
        }
        directionsControl.current = null;
      }
    }
  }, [showDirections, center]);

  // Handle start/stop tracking events for socket.io
  useEffect(() => {
    if (!socket.current) return;

    isTrackingRef.current = isTracking;
    if (isTracking) {
      const newRunId = `run-${Date.now()}`;
      socket.current.emit('start-tracking', {
        userId: user?.id,
        username: user?.username,
        runId: newRunId,
        initialPosition: center[0] !== 0 ? { lat: center[1], lng: center[0] } : null
      });
    } else if (startTime.current && !isTracking) {
      // If we were tracking but now stopped
      socket.current.emit('stop-tracking', {
        finalStats: runStats
      });
    }
    
    if (isTracking) {
      startTime.current = Date.now();
    } else {
      startTime.current = null;
    }
  }, [isTracking, user]);

  // Auto-start tracking if coming from home page "START RUN NOW" button
  useEffect(() => {
    if (location.state?.autoStartTracking && map.current && !isTracking) {
      console.log('🏃 Auto-starting tracking from home page');
      // Small delay to ensure map and marker are ready
      const timer = setTimeout(() => {
        startTracking();
        setShowTracker(true); // Show the run tracker panel
        
        // Clear the autoStartTracking state to prevent re-triggering
        navigate('/map', { replace: true, state: {} });
      }, 1000);
      
      // Clean up the timeout on unmount
      return () => clearTimeout(timer);
    }
  }, [location.state, map.current, isTracking]);

  const fetchTiles = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/tiles', {
        headers: { 'x-auth-token': token }
      });
      const tilesData = Array.isArray(res.data) ? res.data : [];
      console.log('🗺️ Fetched tiles from server:', tilesData.length, 'tiles');
      setTiles(tilesData);
      renderTiles(tilesData);
      console.log(`✅ Tiles refreshed: ${tilesData.length} tiles loaded`);
    } catch (err) {
      console.error('Fetch tiles error:', err.message);
    }
  };

  const fetchNearbyRunners = () => {
    if (!socket.current || !center || center[0] === 0) return;
    
    // Request nearby runners within 5km radius
    socket.current.emit('get-nearby-runners', {
      lat: center[1],
      lng: center[0],
      radius: 5000 // 5km
    });
  };

  const triggerSOS = async () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser. Cannot send SOS.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const token = localStorage.getItem('token');
          await axios.post('/emergency/send-sos', { 
            latitude, 
            longitude,
            message: '🚨 SOS! Emergency assistance needed!' 
          }, {
            headers: { 'x-auth-token': token }
          });
          alert('SOS ALERT SENT TO EMERGENCY CONTACTS!');
        } catch (error) {
          console.error('Error sending SOS:', error);
          alert(error.response?.data?.msg || 'Failed to send SOS alert');
        }
      },
      (error) => {
        let errorMessage = 'Unable to get your location for SOS.';
        if (error.code === 1) {
          errorMessage = 'Location permission denied. Please enable location access in your browser settings to send SOS.';
        } else if (error.code === 2) {
          errorMessage = 'Location service unavailable. Please check your device settings.';
        } else if (error.code === 3) {
          errorMessage = 'Location request timed out. Please try again in an open area.';
        }
        console.error('SOS Geolocation error:', errorMessage, error.message);
        alert(errorMessage);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const toggleTracking = () => {
    if (isTracking) {
      stopTracking();
    } else {
      startTracking();
    }
  };

  const startTracking = () => {
    console.log('▶️ Starting tracking - changing to arrow marker');
    setIsTracking(true);
    setIsRunActive(true);
    isTrackingRef.current = true;
    setRunStats({
      duration: 0,
      distance: 0,
      pace: 0,
      startTime: Date.now()
    });
    setLiveRoute([]);
    
    // Change marker to arrow
    if (userMarker.current) {
      const lngLat = userMarker.current.getLngLat();
      const arrowEl = createArrowMarker(userHeading.current || 0);
      userMarker.current.remove();
      userMarker.current = new mapboxgl.Marker(arrowEl)
        .setLngLat(lngLat)
        .addTo(map.current);
      console.log('✅ Arrow marker created and added to map');
    } else {
      console.error('❌ userMarker.current is null - cannot create arrow marker');
    }
  };

  const stopTracking = async () => {
    console.log('⏹️ Stopping tracking - changing to normal marker');
    setIsTracking(false);
    isTrackingRef.current = false;
    
    // Change marker back to normal
    if (userMarker.current) {
      const lngLat = userMarker.current.getLngLat();
      const normalEl = createNormalMarker();
      userMarker.current.remove();
      userMarker.current = new mapboxgl.Marker(normalEl)
        .setLngLat(lngLat)
        .addTo(map.current);
      console.log('✅ Normal marker restored');
    }
    
    // Note: RunTracker handles saving the run to database
    // This function only handles UI updates (marker, socket)
  };

  const renderTiles = (tilesData) => {
    if (!map.current) {
      console.warn('⚠️ Cannot render tiles: map not initialized');
      return;
    }

    // If tiles are toggled off, just remove existing tiles and don't render new ones
    // Use ref to get current value since this function may be called from various contexts
    if (!showTilesRef.current) {
      if (map.current.getLayer('tiles-layer')) map.current.removeLayer('tiles-layer');
      if (map.current.getSource('tiles')) map.current.removeSource('tiles');
      console.log('🙈 Tiles are toggled off, not rendering');
      return;
    }

    if (!map.current.isStyleLoaded()) {
      console.log('⏳ Waiting for map style to load before rendering tiles...');
      map.current.once('style.load', () => renderTiles(tilesData));
      return;
    }

    if (map.current.getLayer('tiles-layer')) map.current.removeLayer('tiles-layer');
    if (map.current.getSource('tiles')) map.current.removeSource('tiles');

    console.log('🎨 Rendering', tilesData.length, 'tiles on map');

    const features = tilesData
      .filter(tile => tile && tile.geohash) // Filter out invalid tiles
      .map(tile => {
        try {
          const bbox = ngeohash.decode_bbox(tile.geohash);
          const [minLat, minLng, maxLat, maxLng] = bbox;
          const isMine = tile.is_mine === true || tile.is_mine === 'true';
          return {
            type: 'Feature',
            properties: { color: isMine ? '#22c55e' : '#ef4444' },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [minLng, minLat],
                [maxLng, minLat],
                [maxLng, maxLat],
                [minLng, maxLat],
                [minLng, minLat]
              ]]
            }
          };
        } catch (err) {
          console.warn('⚠️ Failed to decode tile geohash:', tile.geohash, err.message);
          return null;
        }
      })
      .filter(feature => feature !== null); // Remove null features

    console.log('📊 Created', features.length, 'valid tile features');

    map.current.addSource('tiles', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    });

    map.current.addLayer({
      id: 'tiles-layer',
      type: 'fill',
      source: 'tiles',
      layout: {
        'visibility': showTiles ? 'visible' : 'none'
      },
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.4,
        'fill-outline-color': '#ffffff'
      }
    });

    console.log('✅ Tiles rendered on map successfully');
    fetchTerritories();
  };

  const fetchTerritories = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/territories', {
        headers: { 'x-auth-token': token }
      });
      if (map.current && res.data.features && res.data.features.length > 0) {
        if (map.current.getSource('territories')) {
          map.current.getSource('territories').setData(res.data);
        } else {
          map.current.addSource('territories', {
            type: 'geojson',
            data: res.data
          });

          map.current.addLayer({
            id: 'territories-layer',
            type: 'fill',
            source: 'territories',
            layout: {
              'visibility': showTiles ? 'visible' : 'none'
            },
            paint: {
              'fill-color': '#00ff00',
              'fill-opacity': 0.3
            }
          });

          map.current.addLayer({
            id: 'territories-outline',
            type: 'line',
            source: 'territories',
            layout: {
              'visibility': showTiles ? 'visible' : 'none'
            },
            paint: {
              'line-color': '#00ff00',
              'line-width': 2
            }
          });
        }
      }
    } catch (err) {
      // Silently ignore
    }
  };

  const syncPendingRuns = async () => {
    try {
      const pendingRuns = JSON.parse(localStorage.getItem('pending_runs')) || [];
      if (pendingRuns.length === 0) return;

      console.log(`📡 Syncing ${pendingRuns.length} pending offline runs...`);
      const token = localStorage.getItem('token');
      let successCount = 0;
      let failedRuns = [];

      for (const pending of pendingRuns) {
        try {
          await axios.post('/runs', pending.runData, {
            headers: { 'x-auth-token': token }
          });
          successCount++;
          console.log(`✅ Synced offline run: ${pending.id}`);
        } catch (err) {
          console.error(`Failed to sync run ${pending.id}:`, err.message);
          failedRuns.push(pending);
        }
      }

      // Update localStorage with only failed runs
      if (failedRuns.length > 0) {
        localStorage.setItem('pending_runs', JSON.stringify(failedRuns));
        console.warn(`⚠️ ${failedRuns.length} runs still pending`);
      } else {
        localStorage.removeItem('pending_runs');
        console.log('✅ All offline runs synced successfully!');
      }

      // Refresh tiles after syncing
      if (successCount > 0) {
        fetchTiles();
        alert(`✅ Synced ${successCount} offline run(s)!`);
      }
    } catch (err) {
      console.error('Error syncing pending runs:', err);
    }
  };

  useEffect(() => {
    if (!isTracking && startMarker.current) {
      startMarker.current.remove();
      startMarker.current = null;
    }
  }, [isTracking]);

  useEffect(() => {
    return () => {
      if (socket.current) socket.current.disconnect();
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
      if (map.current) {
        try {
          map.current.remove();
        } catch (e) {
          console.warn('Error removing map:', e);
        }
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      {/* Map Container - REQUIRED for Mapbox to render */}
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
      
      {locationError && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 bg-red-500 text-white p-4 rounded-lg">
          {locationError}
        </div>
      )}
      
      {/* Map UI Controls - Moved to Bottom Right */}
      <div className="absolute bottom-20 left-4 flex flex-col space-y-2 z-10">
        
        <button 
          onClick={toggleStyle}
          className="p-3 rounded-full shadow-lg transition bg-white text-gray-700"
          title="Toggle Map Style"
        >
          <MapIcon size={20} />
        </button>
        <button 
          onClick={() => {
            const newShowHeatmap = !showHeatmap;
            setShowHeatmap(newShowHeatmap);
            
            if (map.current) {
              if (newShowHeatmap) {
                map.current.setLayoutProperty('heatmap-layer', 'visibility', 'visible');
                fetchHeatmapData();
              } else {
                map.current.setLayoutProperty('heatmap-layer', 'visibility', 'none');
              }
            }
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            const newShowHeatmap = !showHeatmap;
            setShowHeatmap(newShowHeatmap);
            
            if (map.current) {
              if (newShowHeatmap) {
                map.current.setLayoutProperty('heatmap-layer', 'visibility', 'visible');
                fetchHeatmapData();
              } else {
                map.current.setLayoutProperty('heatmap-layer', 'visibility', 'none');
              }
            }
          }}
          className={`p-3 rounded-full shadow-lg transition ${showHeatmap ? 'bg-orange-500 text-white' : 'bg-white text-gray-700'} ${mapStyleMode === 2 ? 'opacity-50 cursor-not-allowed' : ''} active:scale-95 touch-manipulation`}
          title={mapStyleMode === 2 ? "Heatmap auto-enabled in this mode" : "Toggle Heatmap"}
          disabled={mapStyleMode === 2}
        >
          &#x1F525;
        </button>
        <button 
          onClick={() => setShowDirections(!showDirections)}
          className={`p-3 rounded-full shadow-lg transition ${showDirections ? 'bg-blue-500 text-white' : 'bg-white text-gray-700'}`}
          title="Toggle Directions"
        >
          <Route size={20} />
        </button>
      </div>

      {isTracking && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-full shadow-2xl z-20 font-bold flex items-center space-x-3">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
          <span>LIVE TRACKING ACTIVE</span>
        </div>
      )}

      {/* Online Users Count */}
      <div className="absolute bottom-8 right-4 bg-gray-900/80 text-white px-3 py-1 rounded-lg text-xs z-10 flex items-center space-x-2 border border-gray-700">
        <div className={`w-2 h-2 rounded-full ${isSocketConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
        <span>{onlineUsers.length + 1} Runners Online</span>
      </div>  

      {/* Collapsible Directions Panel */}
      {showDirectionsPanel && directionsData && (
        <div
          className="absolute bottom-0 left-0 right-0 bg-white shadow-lg z-30 max-h-96 overflow-hidden md:max-w-md md:left-4 md:bottom-4 md:top-auto md:right-auto cursor-pointer"
          onDoubleClick={() => setShowDirectionsPanel(false)}
          title="Double-click to hide directions panel"
        >
          <div className="p-4 border-b">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold text-lg">Directions</h3>
              <button
                onClick={toggleDirectionsPanel}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="flex space-x-4 text-sm">
              <span>📏 {directionsData.distance} km</span>
              <span>⏱️ {directionsData.duration} min</span>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {directionsData.steps.map((step, index) => (
              <div key={index} className="p-3 border-b border-gray-100 hover:bg-gray-50">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-bold text-blue-600">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-gray-800">{step.instruction}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {step.distance} km • {step.duration} min
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      

      {/* --- Mobile Menu Button - Always Visible on Mobile --- */}
      <div className="absolute top-4 right-4 z-50 md:hidden">
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="bg-gray-800 text-white p-3 rounded-full shadow-lg hover:bg-gray-700 transition flex items-center justify-center"
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            {isMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            )}
          </svg>
        </button>
      </div>

      {/* --- Mobile Menu Panel (Collapsible) --- */}
      {isMenuOpen && (
        <div className="absolute top-20 right-4 left-4 z-[999] md:hidden bg-gray-900 bg-opacity-98 p-4 rounded-xl shadow-2xl max-h-[80vh] overflow-y-auto border border-gray-700">
          <div className="text-white text-center mb-3 pb-2 border-b border-gray-700">
            <span className="font-bold text-lg">Menu</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                toggleTracking();
                setIsMenuOpen(false);
              }}
              className={`${isTracking ? 'bg-red-600' : 'bg-green-600'} text-white px-3 py-3 rounded-lg font-bold shadow-lg hover:opacity-90 transition flex items-center justify-center gap-2 text-sm`}
            >
              {isTracking ? <Activity size={16} /> : <Route size={16} />}
              {isTracking ? 'STOP' : 'START'}
            </button>
            
            <button
              onClick={() => {
                triggerSOS();
                setIsMenuOpen(false);
              }}
              className="bg-red-800 text-white px-3 py-3 rounded-lg font-bold shadow-lg hover:bg-red-900 transition flex items-center justify-center gap-2 text-sm"
            >
              🆘 SOS
            </button>

            <button
              onClick={() => {
                if (isTracking && !showTracker) {
                  setShowTracker(true);
                } else if (showTracker) {
                  setShowTracker(false);
                } else {
                  setShowTracker(true);
                }
                setIsMenuOpen(false);
              }}
              className="bg-blue-600 text-white px-3 py-3 rounded-lg font-bold shadow-lg hover:bg-blue-700 transition text-sm"
            >
              {showTracker ? 'Hide Panel' : isTracking ? 'Show Panel' : 'Start Run'}
            </button>

            <button
              onClick={() => { 
                setShowIntervals(!showIntervals); 
                setIsMenuOpen(false); 
              }}
              className="bg-gray-700 text-white px-3 py-3 rounded-lg font-bold shadow-lg hover:bg-gray-600 transition text-sm"
            >
              ⏱️ Interval
            </button>

            <button
              onClick={toggleStyle}
              className="bg-purple-600 text-white px-3 py-3 rounded-lg font-bold shadow-lg hover:bg-purple-700 transition text-sm"
            >
              🗺️ Style
            </button>

      

            <button
              onClick={() => setShowDirections(!showDirections)}
              className={`${showDirections ? 'bg-blue-500 text-white' : 'bg-white text-gray-700'} px-3 py-3 rounded-lg font-bold shadow-lg transition text-sm`}
            >
              🧭 Directions
            </button>

            <button
              onClick={() => {
                if (directionsControl.current) directionsControl.current.removeRoutes();
                setIsMenuOpen(false);
              }}
              className="bg-red-600 text-white px-3 py-3 rounded-lg font-bold shadow-lg hover:bg-red-700 transition text-sm"
            >
              🗑️ Clear Route
            </button>

            <button
              onClick={() => {
                toggleTiles();
                setIsMenuOpen(false);
              }}
              className={`text-white px-3 py-3 rounded-lg font-bold shadow-lg transition text-sm ${showTiles ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-500 hover:bg-gray-600'}`}
            >
              {showTiles ? '📍 Tiles On' : '📍 Tiles Off'}
            </button>

            {!isSocketConnected && (
              <button
                onClick={() => {
                  reconnectSocket();
                  setIsMenuOpen(false);
                }}
                className="bg-orange-600 hover:bg-orange-700 text-white px-3 py-3 rounded-lg font-bold shadow-lg transition-all duration-200 flex items-center justify-center gap-2 text-sm col-span-2"
              >
                🔌 Reconnect Socket
              </button>
            )}
          </div>

          {/* Desktop Socket Reconnect - Compact button in Online Users section */}
          {!isSocketConnected && (
            <div className="absolute bottom-20 right-4 z-20">
              <button
                onClick={reconnectSocket}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-bold shadow-lg text-xs transition-all duration-200 flex items-center gap-2 animate-pulse"
                title="Reconnect multiplayer (socket disconnected)"
              >
                🔌 Reconnect
              </button>
            </div>
          )}

        </div>
      )}


      {/* --- Desktop Search Button - Top Left (Enhanced) --- */}
      <div className="hidden md:flex absolute top-4 left-4 z-50 flex-col items-start gap-2 p-1 bg-white/80 backdrop-blur-sm rounded-lg shadow-lg border">
        {!showDirections ? (
          <button
            onClick={() => setShowDirections(true)}
            className="bg-white text-black p-3 rounded-full shadow-lg hover:bg-gray-200 transition flex items-center justify-center"
            aria-label="Show directions"
            title="Search for directions"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        ) : (
          <button
            onClick={() => {
              setShowDirections(false);
              if (directionsControl.current && map.current) {
                try {
                  map.current.removeControl(directionsControl.current);
                } catch (e) {}
                directionsControl.current = null;
              }
            }}
            className="bg-red-500 text-white p-3 rounded-full shadow-lg hover:bg-red-600 transition flex items-center justify-center flex-shrink-0"
            aria-label="Close directions"
            title="Close directions"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* --- Desktop Burger Menu Button - Top Right --- */}
      <div className="hidden md:block absolute top-4 right-4 z-50">
        <button
          onClick={() => setIsDesktopMenuOpen(!isDesktopMenuOpen)}
          className="bg-gray-800 text-white p-3 rounded-full shadow-lg hover:bg-gray-700 transition flex items-center justify-center"
          aria-label="Toggle desktop menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            {isDesktopMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            )}
          </svg>
        </button>
      </div>

      {/* --- Desktop Menu Panel (Dropdown) --- */}
      {isDesktopMenuOpen && (
        <div className="hidden md:block absolute top-20 right-4 z-50 bg-gray-900 bg-opacity-95 p-4 rounded-xl shadow-2xl border border-gray-700 max-h-[80vh] overflow-y-auto">
          <div className="text-white text-center mb-3 pb-2 border-b border-gray-700">
            <span className="font-bold text-lg">Menu</span>
          </div>
          <div className="flex flex-col space-y-2 w-48">
            <button
              onClick={() => {
                toggleTracking();
                if (!isTracking) setShowTracker(true);
              }}
              className={`${isTracking ? 'bg-red-600' : 'bg-green-600'} text-white px-4 py-2 rounded-lg font-bold shadow-lg hover:opacity-90 transition flex items-center justify-center gap-2 text-sm`}
            >
              {isTracking ? 'STOP RUN' : 'START RUN'}
            </button>

            <button
              onClick={triggerSOS}
              className="bg-red-800 text-white px-4 py-2 rounded-lg font-bold shadow-lg hover:bg-red-900 transition flex items-center justify-center gap-2 text-sm"
            >
              <span className="text-xl">🆘</span> SOS
            </button>

            <div className="border-t border-gray-700 pt-2"></div>
            
            <button
              onClick={() => setShowIntervals(!showIntervals)}
              className="bg-gray-700 text-white px-3 py-2 rounded-lg font-bold shadow-lg hover:bg-gray-600 transition text-sm"
            >
              ⏱️ Intervals
            </button>

            <div className="border-t border-gray-700 pt-2"></div>

            <button
              onClick={toggleStyle}
              className="bg-purple-600 text-white px-3 py-2 rounded-lg font-bold shadow-lg hover:bg-purple-700 transition text-sm"
              title="Cycle: Dark → Satellite → Streets+Heatmap"
            >
              🗺️ Map Style
            </button>
            
            <button
              onClick={() => setShowDirections(!showDirections)}
              className={`${showDirections ? 'bg-blue-500 text-white' : 'bg-gray-700 text-white'} px-3 py-2 rounded-lg font-bold shadow-lg hover:opacity-90 transition text-sm`}
            >
              🧭 Directions
            </button>

            <div className="border-t border-gray-700 pt-2"></div>

            <button
              onClick={() => {
                if (directionsControl.current) {
                  directionsControl.current.removeRoutes();
                }
              }}
              className="bg-red-600 text-white px-3 py-2 rounded-lg font-bold shadow-lg hover:bg-red-700 transition text-sm"
            >
              🗑️ Clear Route
            </button>
            
            <button
              onClick={toggleTiles}
              className={`text-white px-3 py-2 rounded-lg font-bold shadow-lg transition text-sm ${showTiles ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-500 hover:bg-gray-600'}`}
            >
              {showTiles ? '📍 Tiles On' : '📍 Tiles Off'}
            </button>
          </div>
        </div>
      )}

{showIntervals && (
        <div className="absolute top-28 left-4 md:left-80 z-50 w-80 animate-in slide-in-from-right duration-300">
          <IntervalTimer onClose={() => setShowIntervals(false)} />
        </div>
      )}


      {showTracker && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 w-full max-w-md px-4">
          <RunTracker 
            isTracking={isTracking}
            setIsTracking={setIsTracking}
            runStats={runStats}
            setRunStats={setRunStats}
            onRouteUpdate={(route) => {
              console.log('📥 Received route update from RunTracker:', route.length, 'points');
              // Update liveRoute when RunTracker gets new GPS points
              // Convert from [{lat, lng}] to [[lng, lat]] format
              const convertedRoute = route.map(point => [point.lng, point.lat]);
              console.log('🔄 Converted route format, updating liveRoute state');
              setLiveRoute(convertedRoute);
              
              // Update the map route line
              if (map.current?.getSource('live-route')) {
                map.current.getSource('live-route').setData({
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: convertedRoute
                  }
                });
                console.log('🗺️ Updated live-route on map');
              }
            }}
            onRunComplete={() => {
              console.log('🏁 Run completed, refreshing tiles...');
              setShowTracker(false);
              setIsRunActive(false);
              setIsTracking(false);
              setRunStats({ duration: 0, distance: 0, pace: 0, startTime: null });
              setLiveRoute([]);
              if (map.current && map.current.getSource('live-route')) {
                map.current.getSource('live-route').setData({
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'LineString', coordinates: [] }
                });
              }
              // Refresh tiles to show newly captured territory
              fetchTiles();
            }} 
          />
        </div>
      )}
      
      {/* Minimized Run Indicator - shows when tracking but panel is hidden */}
      {isTracking && !showTracker && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 bg-gray-800 text-white px-6 py-3 rounded-full shadow-lg flex items-center space-x-4 cursor-pointer hover:bg-gray-700 transition" onClick={() => setShowTracker(true)}>
          <div className="flex items-center">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse mr-2"></span>
            <span className="font-bold">Run in Progress</span>
          </div>
          <div className="text-gray-400">|</div>
          <div className="text-sm">
            <span className="text-blue-400">{(runStats.distance / 1000).toFixed(2)} km</span>
            <span className="text-gray-500 mx-2">•</span>
            <span className="text-green-400">{Math.floor(runStats.duration / 60)}m {runStats.duration % 60}s</span>
          </div>
          <div className="text-gray-400 text-xs">(Click to show)</div>
        </div>
      )}

      {/* Following Status Indicator */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-800/80 backdrop-blur-sm text-white text-[10px] px-3 py-1 rounded-full z-10 border border-gray-700">
        Follow Me: {isFollowingUser ? 'ON' : 'OFF'}
      </div>

      {/* Recenter Button */}
      {!isFollowingUser && (
        <button
          onClick={() => {
            setIsFollowingUser(true);
            if (map.current && currentLocation) {
              map.current.flyTo({ center: currentLocation, zoom: 16, duration: 1000 });
            }
          }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-full shadow-lg hover:bg-blue-700 transition-all z-10 font-bold flex items-center gap-2"
        >
          <MapIcon size={16} />
          Recenter
        </button>
      )}

      {/* User Profile Modal */}
      <UserProfileModal
        userId={selectedUser?.id}
        username={selectedUser?.username}
        isOpen={isProfileModalOpen}
        onClose={() => {
          setIsProfileModalOpen(false);
          setSelectedUser(null);
        }}
      />
    </div>
  );
};

export default MapboxMap;
