import React, { useState, useEffect } from 'react';

/**
 * CountUp Component
 * High-performance numeric count-up animation helper utilizing requestAnimationFrame.
 * Automatically falls back to standard text formatting for non-numeric values.
 */
export default function CountUp({ end, duration = 1.0 }) {
  const [count, setCount] = useState(() => {
    const initialNum = parseFloat(end);
    return isNaN(initialNum) ? end : 0;
  });

  useEffect(() => {
    const endNum = parseFloat(end);
    if (isNaN(endNum)) {
      setCount(end);
      return;
    }

    let start = 0;
    let animFrameId = null;
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsedTime = (currentTime - startTime) / 1000;
      if (elapsedTime >= duration) {
        setCount(endNum);
        return;
      }

      const progress = elapsedTime / duration;
      // Cubic ease-out curve
      const easeOutProgress = 1 - Math.pow(1 - progress, 3);
      const currentCount = Math.round(start + easeOutProgress * (endNum - start));

      setCount(currentCount);
      animFrameId = requestAnimationFrame(animate);
    };

    animFrameId = requestAnimationFrame(animate);

    return () => {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
      }
    };
  }, [end, duration]);

  return <span>{count}</span>;
}
