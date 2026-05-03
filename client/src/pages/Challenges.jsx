import React, { useState, useEffect, useContext } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Flame, Map, Clock, Target, Rocket } from 'lucide-react';
import Card from '../components/ui/Card';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const CHALLENGES_CONFIG = [
  {
    id: 'marathoner',
    title: 'The Marathoner',
    description: 'Accumulate 42.2km of running distance over the course of a single week.',
    icon: <Target className="text-red-500" size={32} />,
    reward: '500 XP & Marathon Badge',
    difficulty: 'Hard',
    target: 42.2,
    unit: 'km',
    getProgress: (stats, weeklyStats) => weeklyStats?.distance_this_week / 1000 || 0
  },
  {
    id: 'speed_demon',
    title: 'Speed Demon',
    description: 'Maintain an aggressive pace under 4:30 min/km for an entire 3km run.',
    icon: <Flame className="text-orange-500" size={32} />,
    reward: '350 XP & Flame Badge',
    difficulty: 'Extreme',
    target: 1,
    unit: 'run',
    getProgress: (stats) => 0 // TODO: Implement based on runs with pace < 4:30
  },
  {
    id: 'tile_king',
    title: 'Territory Conqueror',
    description: 'Capture 15 completely new territory tiles in a single 24-hour period.',
    icon: <Map className="text-purple-500" size={32} />,
    reward: '400 XP & Crown Badge',
    difficulty: 'Medium',
    target: 15,
    unit: 'tiles',
    getProgress: (stats) => 0 // TODO: Implement based on daily tile captures
  },
  {
    id: 'consistency',
    title: 'Endless Hustle',
    description: 'Run at least 2.0km for 7 consecutive days without skipping a day.',
    icon: <Clock className="text-blue-500" size={32} />,
    reward: '600 XP & Iron Tracker',
    difficulty: 'Hard',
    target: 7,
    unit: 'days',
    getProgress: (stats) => stats?.streak || 0
  }
];

const Challenges = () => {
  const { user } = useContext(AuthContext);
  const [activeChallenge, setActiveChallenge] = useState('marathoner');
  const [stats, setStats] = useState(null);
  const [weeklyStats, setWeeklyStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchChallengeData = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const [statsRes, weeklyRes] = await Promise.all([
          axios.get(`/users/stats/${user.id}`),
          axios.get(`/users/weekly-stats/${user.id}`)
        ]);
        
        setStats(statsRes.data);
        setWeeklyStats(weeklyRes.data);
      } catch (error) {
        console.error('Error fetching challenge data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchChallengeData();
  }, [user?.id]);

  // Calculate dynamic challenges based on user data
  const challenges = CHALLENGES_CONFIG.map(challenge => ({
    ...challenge,
    progress: challenge.getProgress(stats, weeklyStats)
  }));

  const handleActivate = (id) => {
    setActiveChallenge(id);
  };

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 bg-gray-900 min-h-screen text-white flex items-center justify-center">
        <div className="animate-pulse text-center">
          <Trophy className="text-orange-500 mx-auto mb-4" size={48} />
          <div className="h-8 bg-gray-700 rounded w-64 mx-auto mb-2"></div>
          <div className="h-4 bg-gray-700 rounded w-48 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-gray-900 min-h-screen text-white page-enter">
      <div className="max-w-6xl mx-auto">
        <header className="mb-10 text-center">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center justify-center p-4 bg-orange-500/10 rounded-full mb-4"
          >
            <Trophy className="text-orange-500" size={48} />
          </motion.div>
          <h1 className="text-4xl sm:text-5xl font-black gradient-text mb-4">Elite Challenges</h1>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg">
            Push yourself beyond daily limits. Activate an elite challenge to track extreme long-term goals and earn massive XP payouts!
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {challenges.map((challenge, idx) => {
            const isActive = activeChallenge === challenge.id;
            const progressPercent = Math.min((challenge.progress / challenge.target) * 100, 100);

            return (
              <motion.div
                key={challenge.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.1 }}
              >
                <Card className={`p-6 sm:p-8 relative overflow-hidden transition-all duration-300 ${
                  isActive ? 'border-2 border-orange-500 shadow-[0_0_30px_rgba(249,115,22,0.2)] bg-gray-800/80' : 'border border-gray-700/50 hover:border-gray-500 bg-gray-800/40'
                }`}>
                  {isActive && (
                    <div className="absolute top-0 right-0 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl z-20">
                      ACTIVE
                    </div>
                  )}
                  
                  {/* Background Icon */}
                  <div className="absolute -right-6 -bottom-6 opacity-[0.03] pointer-events-none scale-150">
                    {challenge.icon}
                  </div>

                  <div className="flex items-start gap-4 mb-4 relative z-10">
                    <div className={`p-4 rounded-2xl ${isActive ? 'bg-gray-900 border border-orange-500/30' : 'bg-gray-900/50'}`}>
                      {challenge.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-xl font-bold text-white">{challenge.title}</h3>
                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          challenge.difficulty === 'Extreme' ? 'bg-red-500/20 text-red-400' :
                          challenge.difficulty === 'Hard' ? 'bg-orange-500/20 text-orange-400' :
                          'bg-blue-500/20 text-blue-400'
                        }`}>
                          {challenge.difficulty}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 leading-relaxed mb-3">
                        {challenge.description}
                      </p>
                      <div className="inline-block bg-gray-900/80 px-3 py-1.5 rounded-lg border border-gray-700">
                        <span className="text-xs font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-orange-400">
                          Reward: {challenge.reward}
                        </span>
                      </div>
                    </div>
                  </div>

                  {isActive ? (
                    <div className="mt-6 pt-6 border-t border-gray-700/50 relative z-10">
                      <div className="flex justify-between text-sm font-bold mb-2">
                        <span className="text-gray-300">Current Progress</span>
                        <span className="text-orange-400">{challenge.progress} / {challenge.target} {challenge.unit}</span>
                      </div>
                      <div className="w-full bg-gray-900 rounded-full h-3 overflow-hidden border border-gray-700">
                        <div 
                          className="bg-gradient-to-r from-orange-500 to-red-500 h-3 transition-all duration-1000 relative"
                          style={{ width: `${progressPercent}%` }}
                        >
                          <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 pt-6 border-t border-gray-700/50 relative z-10 flex justify-end">
                      <button 
                        onClick={() => handleActivate(challenge.id)}
                        className="flex items-center gap-2 text-sm font-bold text-gray-400 hover:text-white transition-colors bg-gray-900/50 hover:bg-gray-700 px-4 py-2 rounded-xl"
                      >
                        <Rocket size={16} />
                        Activate Challenge
                      </button>
                    </div>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Challenges;
