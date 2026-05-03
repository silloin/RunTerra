import React, { useContext, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import { motion } from 'framer-motion';
import { 
  Play, 
  Map as MapIcon, 
  Trophy, 
  Users, 
  History, 
  TrendingUp, 
  Award,
  Zap,
  Activity,
  Cloud,
  Sun,
  CloudRain,
  Snowflake,
  Wind,
  Droplets,
  Thermometer,
  Target
} from 'lucide-react';
import SOSButton from '../components/SOSButton';
import Skeleton from '../components/Skeleton';
import Card from '../components/ui/Card';

const Home = () => {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recentRuns, setRecentRuns] = useState([]);
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [geoError, setGeoError] = useState(null);

  const safeRuns = Array.isArray(recentRuns) ? recentRuns : [];

  // Handle start run - navigate to map and auto-start tracking
  const handleStartRun = () => {
    navigate('/map', { state: { autoStartTracking: true } });
  };

  // Helper functions for weather display
  const getWeatherIcon = (condition) => {
    const icons = {
      Clear: <Sun className="text-yellow-400" size={32} />,
      Clouds: <Cloud className="text-gray-400" size={32} />,
      Rain: <CloudRain className="text-blue-400" size={32} />,
      Snow: <Snowflake className="text-blue-200" size={32} />,
      Thunderstorm: <CloudRain className="text-purple-400" size={32} />,
      Drizzle: <CloudRain className="text-blue-300" size={32} />
    };
    return icons[condition] || <Cloud className="text-gray-400" size={32} />;
  };

  const getAQIColor = (aqi) => {
    if (aqi <= 50) return 'text-green-400';
    if (aqi <= 100) return 'text-yellow-400';
    if (aqi <= 150) return 'text-orange-400';
    if (aqi <= 200) return 'text-red-400';
    return 'text-red-600';
  };

  const getAQILabel = (aqi) => {
    if (aqi <= 50) return 'Good';
    if (aqi <= 100) return 'Moderate';
    if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
    if (aqi <= 200) return 'Unhealthy';
    if (aqi <= 300) return 'Very Unhealthy';
    return 'Hazardous';
  };

  const getAQIBarColor = (aqi) => {
    if (aqi <= 50) return 'bg-green-500';
    if (aqi <= 100) return 'bg-yellow-500';
    if (aqi <= 150) return 'bg-orange-500';
    if (aqi <= 200) return 'bg-red-500';
    if (aqi <= 300) return 'bg-purple-600';
    return 'bg-red-900';
  };

  useEffect(() => {
    const fetchHomeData = async () => {
      try {
        if (!user?.id) {
          setStats(null);
          setLoading(false);
          return;
        }
        const [statsRes, runsRes] = await Promise.all([
          axios.get(`/users/stats/${user.id}`),
          axios.get('/runs?limit=3')
        ]);
        setStats(statsRes.data);
        const runs = runsRes.data;
        setRecentRuns(Array.isArray(runs) ? runs : (Array.isArray(runs?.runs) ? runs.runs : Array.isArray(runs?.data) ? runs.data : []));
        
        // Fetch weather using geolocation with robust error handling
        fetchWeatherWithFallback();
      } catch (error) {
        console.error('Error fetching home data:', error);
        setRecentRuns([]);
      } finally {
        setLoading(false);
      }
    };

    const fetchWeatherWithFallback = () => {
      if (!navigator.geolocation) {
        console.warn('Geolocation not supported by this browser');
        setGeoError('Geolocation not supported');
        fetchDefaultWeather();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          setGeoError(null);
          try {
            const weatherRes = await axios.get('/users/weather', {
              params: {
                lat: position.coords.latitude,
                lng: position.coords.longitude
              }
            });
            setWeather(weatherRes.data);
          } catch (err) {
            console.error('Error fetching weather:', err);
            fetchDefaultWeather();
          }
        },
        (error) => {
          // Handle specific geolocation errors
          let errorMessage = 'Location unavailable';
          switch(error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Location permission denied. Using default location.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Location information unavailable. Using default location.';
              break;
            case error.TIMEOUT:
              errorMessage = 'Location request timed out. Using default location.';
              break;
            default:
              errorMessage = 'An unknown error occurred. Using default location.';
          }
          console.error('Geolocation error:', errorMessage, error);
          setGeoError(errorMessage);
          fetchDefaultWeather();
        },
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 600000 // 10 minutes cache
        }
      );
    };

    const fetchDefaultWeather = async () => {
      try {
        const weatherRes = await axios.get('/users/weather', {
          params: { lat: 25.2048, lng: 55.2708 } // Dubai coordinates
        });
        setWeather(weatherRes.data);
      } catch (err) {
        console.error('Error fetching default weather:', err);
      }
    };

    fetchHomeData();
  }, [user?.id]);

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 bg-gray-900/50 text-white space-y-6">
        {/* Welcome Section Skeleton */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-3 flex-1">
            <Skeleton type="text-lg" width="250px" height="36px" />
            <Skeleton type="text" width="200px" />
          </div>
           <Skeleton type="rect" width="200px" height="56px" className="hidden md:block" />
        </div>

        {/* Quick Stats Skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-gray-800/40 p-4 rounded-2xl border border-gray-700/50 space-y-3">
              <Skeleton type="circle" width="40px" height="40px" />
              <Skeleton type="text" width="80px" />
              <Skeleton type="text-lg" width="60px" />
            </div>
          ))}
        </div>

        {/* Content Skeleton */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Recent Runs Skeleton */}
            <div className="space-y-4">
              <Skeleton type="text-lg" width="150px" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-gray-800/40 p-4 rounded-2xl border border-gray-700/50 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Skeleton type="circle" width="48px" height="48px" />
                    <div className="space-y-2">
                      <Skeleton type="text" width="120px" />
                      <Skeleton type="text-sm" width="150px" />
                    </div>
                  </div>
                  <Skeleton type="text" width="80px" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-6">
            {/* Sidebar Skeleton */}
            <Skeleton type="card" height="200px" />
            <Skeleton type="card" height="200px" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-gray-900/50 text-white space-y-6 sm:space-y-8 page-enter">
      {/* Welcome Section */}
      <motion.header 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative"
      >
        {/* Background Glow */}
        <div className="absolute inset-0 bg-gradient-to-r from-orange-600/10 via-red-600/10 to-orange-600/10 blur-3xl -z-10" />
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black gradient-text mb-2">
              RUN THE CITY
            </h1>
            <p className="text-gray-300 mt-2 text-lg">Welcome back, <span className="font-bold text-orange-400">{user?.username}</span>!</p>
            <p className="text-gray-500 text-sm mt-1">Ready for your next territory conquest?</p>
          </div>
          <button 
            onClick={handleStartRun}
            className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white px-8 py-4 rounded-xl font-bold shadow-lg hover:shadow-orange-500/30 hover:shadow-xl transition-all flex items-center gap-3 transform hover:scale-105 active:scale-95"
          >
            <Play fill="white" size={24} />
            START RUN NOW
          </button>
        </div>
      </motion.header>

      {/* Quick Stats Grid */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        {[
          { label: 'Total Distance', value: `${Number(stats?.total_distance || 0).toFixed(2)} km`, icon: <TrendingUp className="text-orange-400" />, color: 'from-orange-500/10 to-red-500/10', border: 'border-orange-500/30' },
          { label: 'Tiles Owned', value: stats?.total_tiles ?? stats?.territories_captured ?? 0, icon: <MapIcon className="text-red-400" />, color: 'from-red-500/10 to-orange-500/10', border: 'border-red-500/30' },
          { label: 'Level', value: stats?.level || user?.level || 1, icon: <Award className="text-orange-400" />, color: 'from-orange-500/10 to-red-500/10', border: 'border-orange-500/30' },
          { label: 'XP Points', value: stats?.xp || user?.xp || 0, icon: <Zap className="text-red-400" />, color: 'from-red-500/10 to-orange-500/10', border: 'border-red-500/30' },
        ].map((stat, idx) => (
          <motion.div 
            key={idx} 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: idx * 0.1 }}
            whileHover={{ scale: 1.05, y: -5 }}
          >
            <Card className={`bg-gradient-to-br ${stat.color} border ${stat.border} p-4`}>
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gray-900/50 rounded-xl backdrop-blur-sm">{stat.icon}</div>
                <div>
                  <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold">{stat.label}</p>
                  <p className="text-2xl font-black text-white">{stat.value}</p>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-8">
          {/* New Features Highlights */}
          {/* Recent Runs */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2 gradient-text">
                <History className="text-orange-400" size={20} />
                Recent Runs
              </h2>
              <Link to="/runs" className="text-orange-400 hover:text-red-400 text-sm font-semibold transition hover:underline">View All</Link>
            </div>
            <div className="space-y-3">
              {safeRuns.length > 0 ? (
                safeRuns.map((run) => (
                  <Card key={run.id} className="p-4 flex items-center justify-between hover:scale-[1.01] transition-transform">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-full flex items-center justify-center text-orange-400 border border-orange-500/30">
                        <Activity size={24} />
                      </div>
                      <div>
                        <h4 className="font-bold text-white">{new Date(run.completed_at).toLocaleDateString()}</h4>
                        <p className="text-gray-400 text-xs">{(run.distance / 1000).toFixed(2)} km • {Math.floor(run.duration / 60)}m {run.duration % 60}s</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-orange-400">{Number(run.pace)?.toFixed(2) ?? 'N/A'} min/km</p>
                      <p className="text-gray-500 text-[10px] uppercase tracking-tighter font-bold">min/km</p>
                    </div>
                  </Card>
                ))
              ) : (
                <Card className="text-center py-8">
                  <p className="text-gray-400">No runs yet. Get out there and start running!</p>
                </Card>
              )}
            </div>
          </section>
        </div>

        {/* Sidebar / Leaderboard Preview */}
        <div className="space-y-8">
          {/* Weather Widget */}
          <motion.section
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Card className="p-6">
              {!weather ? (
                <div className="text-center py-8">
                  <p className="text-gray-400">Loading weather...</p>
                  {geoError && (
                    <p className="text-xs text-yellow-500 mt-2">{geoError}</p>
                  )}
                </div>
              ) : (
              <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2 gradient-text">
                    <Thermometer className="text-orange-400" size={20} />
                    Current Weather
                  </h2>
                  {weather.weather?.location && (
                    <p className="text-xs text-gray-500 mt-1">
                      📍 {weather.weather?.location?.city}, {weather.weather?.location?.country}
                    </p>
                  )}
                </div>
                {getWeatherIcon(weather.weather?.condition)}
              </div>
              
                {/* Temperature */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Temperature</span>
                  <div className="text-right">
                    <span className="text-2xl font-bold">{Math.round(weather.weather?.temp || 0)}°C</span>
                    {weather.weather?.feels_like && (
                      <p className="text-xs text-gray-500">Feels like {Math.round(weather.weather?.feels_like)}°C</p>
                    )}
                  </div>
                </div>
                
                {/* Condition */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Condition</span>
                  <span className="font-semibold capitalize">{weather.weather?.description || weather.weather?.condition}</span>
                </div>
                
                {/* Humidity */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <Droplets size={16} />
                    Humidity
                  </div>
                  <span className="font-semibold">{weather.weather?.humidity}%</span>
                </div>
                
                {/* Wind Speed */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <Wind size={16} />
                    Wind
                  </div>
                  <span className="font-semibold">{weather.weather?.windSpeed} m/s</span>
                </div>

                {/* Visibility & Pressure */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  {weather.weather?.visibility && (
                    <div className="bg-gray-800/50 p-2 rounded-lg">
                      <p className="text-xs text-gray-500">Visibility</p>
                      <p className="font-semibold text-sm">{weather.weather?.visibility} km</p>
                    </div>
                  )}
                  {weather.weather?.pressure && (
                    <div className="bg-gray-800/50 p-2 rounded-lg">
                      <p className="text-xs text-gray-500">Pressure</p>
                      <p className="font-semibold text-sm">{weather.weather?.pressure} hPa</p>
                    </div>
                  )}
                </div>
                
                {/* Air Quality Index */}
                <div className="pt-3 border-t border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-400 text-sm">Air Quality Index (AQI)</span>
                    <div className="text-right">
                      <span className={`font-bold text-lg ${getAQIColor(weather.weather?.aqi)}`}>
                        {weather.weather?.aqi}
                      </span>
                      <p className={`text-xs ${getAQIColor(weather.weather?.aqi)}`}>
                        {getAQILabel(weather.weather?.aqi)}
                      </p>
                    </div>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-3">
                    <div 
                      className={`h-3 rounded-full transition-all ${getAQIBarColor(weather.weather?.aqi)}`}
                      style={{ width: `${Math.min(((weather.weather?.aqi || 0) / 500) * 100, 100)}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between mt-1">
                    <p className="text-xs text-gray-500">0</p>
                    <p className="text-xs text-gray-500">500+</p>
                  </div>
                  {weather.weather?.aqiSource && (
                    <p className="text-xs text-gray-600 mt-1 text-center">
                      Source: {weather.weather?.aqiSource}
                    </p>
                  )}
                </div>
                
                {/* Training Recommendation */}
                {weather.recommendation?.recommendations?.length > 0 && (
                  <div className={`p-3 rounded-xl mt-3 ${
                    weather.recommendation?.canRun ? 'bg-green-900/30 border border-green-500/30' : 'bg-red-900/30 border border-red-500/30'
                  }`}>
                    <p className={`text-xs font-bold mb-2 ${
                      weather.recommendation?.canRun ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {weather.recommendation?.canRun ? '✓ Good for Running' : '⚠ Caution Advised'}
                    </p>
                    <ul className="space-y-1">
                      {weather.recommendation?.recommendations?.map((rec, idx) => (
                        <li key={idx} className="text-xs text-gray-300">• {rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              )}
            </Card>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <Trophy className="text-yellow-400" size={24} />
                <h2 className="text-xl font-bold gradient-text">Top Runners</h2>
              </div>
              {/* Quick leaderboard list could go here */}
              <div className="space-y-4">
                <p className="text-gray-400 text-sm italic">Connect with others to see your ranking among friends.</p>
                <Link to="/leaderboard" className="block w-full text-center py-3 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 rounded-xl font-bold transition shadow-lg hover:shadow-orange-500/30 hover:shadow-xl transform hover:scale-105">
                  Full Leaderboard
                </Link>
              </div>
            </Card>
          </motion.section>

          {/* Elite Challenges Preview */}
          <motion.section 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.45 }}
          >
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <Target className="text-red-400" size={24} />
                <h2 className="text-xl font-bold gradient-text">Challenge Modes</h2>
              </div>
              <div className="space-y-4">
                <p className="text-gray-400 text-sm italic">Push yourself to the limit with extreme long-term quests.</p>
                <Link to="/challenges" className="block w-full text-center py-3 bg-gradient-to-r from-red-600 to-purple-600 hover:from-red-700 hover:to-purple-700 rounded-xl font-bold transition shadow-lg hover:shadow-red-500/30 hover:shadow-xl transform hover:scale-105">
                  View Challenges
                </Link>
              </div>
            </Card>
          </motion.section>

          {/* Training Tip */}
          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            whileHover={{ scale: 1.02 }}
          >
            <Card className="bg-gradient-to-r from-orange-600 to-red-600 p-6 text-white relative overflow-hidden group shadow-2xl hover:shadow-orange-500/30" hover={false}>
              <div className="relative z-10">
                <h3 className="font-bold text-lg mb-2">Pro Tip</h3>
                <p className="text-white/90 text-sm">Run through new areas to capture territories and earn 2x XP points today!</p>
              </div>
              <div className="absolute -right-4 -bottom-4 opacity-20 group-hover:scale-110 transition-transform duration-500">
                <TrendingUp size={120} />
              </div>
            </Card>
          </motion.section>
        </div>
      </div>
      
      {/* SOS Emergency Button - Fixed Position */}
      <SOSButton />
    </div>
  );
};

export default Home;

