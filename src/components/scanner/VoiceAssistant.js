/**
 * VoiceAssistant Utility
 * Handles speech synthesis greeting engine for check-in / check-out voice prompts.
 */
export const speakGreeting = (text, voiceEnabled = true) => {
  if (!voiceEnabled || !window.speechSynthesis) return;
  
  console.log('[SPEECH SYNTHESIS ANNOUNCEMENT]:', text);
  
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.cancel(); // Clear any queued speech
    
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95; // Slightly slower for perfect phonetic clarity
      utterance.pitch = 1.0;
      
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const englishVoice = voices.find(v => v.lang.includes('en-US') || v.lang.includes('en-GB'));
        if (englishVoice) {
          utterance.voice = englishVoice;
        }
      }
      
      utterance.onerror = (e) => {
        console.error('[SPEECH SYNTHESIS PLAYBACK ERROR]:', e);
      };
      
      window.speechSynthesis.speak(utterance);
    }, 60); // 60ms delay ensures browser finishes queue clearance
  } catch (err) {
    console.error('[SPEECH SYNTHESIS ENGINE EXCEPTION]:', err);
  }
};
