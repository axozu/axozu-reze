// Функции плавности. Все принимают t в [0..1] и возвращают значение в [0..1].
// Подключается как обычный скрипт и кладёт объект в window.Easing.
(function (global) {
  'use strict';

  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

  const Easing = {
    clamp01,
    linear: (t) => clamp01(t),
    // Синусоидальный ease-in-out — мягкий старт и мягкая остановка.
    easeInOutSine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t)),
    // Кубический ease-in-out — чуть более «упругий» разгон, чем синус.
    easeInOutCubic: (t) => {
      t = clamp01(t);
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
    easeInOutQuad: (t) => {
      t = clamp01(t);
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    },
    // Smoothstep: нулевая производная на обоих концах.
    smoothstep: (t) => {
      t = clamp01(t);
      return t * t * (3 - 2 * t);
    },
    // Значение участка [a..b] на временной оси -> [0..1] с заданной плавностью.
    range: (x, a, b, fn) => {
      if (b <= a) return x >= b ? 1 : 0;
      return (fn || Easing.linear)((x - a) / (b - a));
    },
  };

  global.Easing = Easing;
})(typeof window !== 'undefined' ? window : globalThis);
