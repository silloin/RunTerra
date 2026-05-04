import React, { useContext, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { AuthProvider, AuthContext } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Map from './components/Map/Map';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Leaderboard from './pages/Leaderboard';
import TrainingPlans from './pages/TrainingPlans';
import Events from './pages/Events';
import Profile from './pages/Profile';
import RunHistory from './pages/RunHistory';
import Sidebar from './components/Sidebar';
import SocialFeed from './components/SocialFeed';
import Challenges from './pages/Challenges';
import Achievements from './components/Achievements/Achievements';
import ChatLayout from './components/Chat/ChatLayout';
import ErrorBoundary from './components/ErrorBoundary';
import { Menu } from 'lucide-react';
import './App.css';

// ProtectedRoute: blocks children until auth is resolved
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useContext(AuthContext);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-gray-900 flex items-center justify-center text-white text-2xl font-bold">
        🏃 Loading...
      </div>
    );
  }

  if (!user) {
    console.warn('❌ No user found, redirecting to login');
    return <Navigate to="/login" replace />;
  }

  return children;
};

const Layout = ({ children }) => {
  const { user } = useContext(AuthContext);
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isPrivateChatActive, setIsPrivateChatActive] = useState(false);

  // Auto-close sidebar when route changes
  useEffect(() => {
    setSidebarOpen(false);
    // Reset isPrivateChatActive when navigating away from chat
    if (location.pathname !== '/chat') {
      setIsPrivateChatActive(false);
    }
  }, [location.pathname]);

  // Hide sidebar on mobile for certain routes
  const hideSidebarOnMobile = location.pathname === '/chat';

  // Special layout for chat route - full height without constraints
  if (location.pathname === '/chat') {
    return (
      <div className="flex flex-col md:flex-row w-full h-[100dvh] bg-gray-900">
        {/* Mobile Horizontal Top Navigation for Chat */}
        {!isPrivateChatActive && (
          <div className="md:hidden bg-gray-900/90 backdrop-blur-xl border-b border-gray-800/50 flex-shrink-0">
            <div className="flex items-center px-4 py-2">
              <h1 className="text-lg font-black gradient-text">ZoneRush</h1>
            </div>
            {/* Horizontal Scrollable Menu - All Pages */}
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent px-2 pb-2">
              <div className="flex space-x-1 min-w-max">
                {[
                  { name: 'Home', path: '/' },
                  { name: 'Live Map', path: '/map' },
                  { name: 'Dashboard', path: '/dashboard' },
                  { name: 'Run History', path: '/runs' },
                  { name: 'Leaderboard', path: '/leaderboard' },
                  { name: 'Social Feed', path: '/social' },
                  { name: 'Chat', path: '/chat' },
                  { name: 'Achievements', path: '/achievements' },
                  { name: 'Challenges', path: '/challenges' },
                  { name: 'Training Plans', path: '/training' },
                  { name: 'Events', path: '/events' },
                  { name: 'Profile', path: '/profile' },
                ].map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.name}
                      to={item.path}
                      className={`
                        px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition
                        ${isActive
                          ? 'bg-gradient-to-r from-orange-600/20 to-red-600/20 text-orange-400 border border-orange-500/50'
                          : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                        }
                      `}
                    >
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {!isPrivateChatActive && !isPrivateChatActive && <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} isChatActive={isPrivateChatActive} />}
        <div className="flex-1 relative h-full">
          <ChatLayout onPrivateChatActiveChange={setIsPrivateChatActive} />
        </div>
      </div>
    );
  }

  // Special layout for map route - full screen without scrolling
  if (location.pathname === '/map') {
    return (
      <div className="flex flex-col md:flex-row w-full h-[100dvh] bg-gray-900 overflow-hidden">
        {/* Mobile Burger Menu Button */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden fixed top-4 left-4 z-30 p-2 bg-gray-900/90 backdrop-blur-xl rounded-xl border border-gray-700/50 shadow-lg hover:bg-gray-800/90 transition"
          aria-label="Open sidebar"
        >
          <Menu size={24} className="text-white" />
        </button>

        {!isPrivateChatActive && <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} isChatActive={isPrivateChatActive} />}
        <div className="flex-1 relative h-[100dvh] overflow-hidden">
          {children}
        </div>
      </div>
    );
  }

  // Default layout - horizontal top nav on mobile, sidebar on desktop
  return (
    <div className="flex flex-col md:flex-row w-full h-screen h-[100dvh] overflow-hidden bg-gray-900">
      {/* Mobile Horizontal Top Navigation */}
      <div className="md:hidden bg-gray-900/90 backdrop-blur-xl border-b border-gray-800/50 flex-shrink-0">
        <div className="flex items-center px-4 py-2">
          <h1 className="text-lg font-black gradient-text">ZoneRush</h1>
        </div>
        {/* Horizontal Scrollable Menu - All Pages */}
        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent px-2 pb-2">
          <div className="flex space-x-1 min-w-max">
            {[
              { name: 'Home', path: '/' },
              { name: 'Live Map', path: '/map' },
              { name: 'Dashboard', path: '/dashboard' },
              { name: 'Run History', path: '/runs' },
              { name: 'Leaderboard', path: '/leaderboard' },
              { name: 'Social Feed', path: '/social' },
              { name: 'Chat', path: '/chat' },
              { name: 'Achievements', path: '/achievements' },
              { name: 'Challenges', path: '/challenges' },
              { name: 'Training Plans', path: '/training' },
              { name: 'Events', path: '/events' },
              { name: 'Profile', path: '/profile' },
            ].map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  className={`
                    px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition
                    ${isActive
                      ? 'bg-gradient-to-r from-orange-600/20 to-red-600/20 text-orange-400 border border-orange-500/50'
                      : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                    }
                  `}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} isChatActive={isPrivateChatActive} />
      <div className="flex-1 relative h-full overflow-y-auto">
        {children}
      </div>
    </div>
  );
};

// Wrapper component to pass userId to Achievements
const AchievementsWrapper = () => {
  const { user } = useContext(AuthContext);
  return <Achievements userId={user?.id} />;
};

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <SocketProvider>
          <div className="App w-full h-screen h-[100dvh] overflow-hidden">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Home />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/map"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Map />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Dashboard />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/leaderboard"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Leaderboard />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/training"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <TrainingPlans />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/events"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Events />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Profile />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/social"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <SocialFeed />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/achievements"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <AchievementsWrapper />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/challenges"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Challenges />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/runs"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <RunHistory />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chat"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </div>
        </SocketProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;