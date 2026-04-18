interface SpringTransition {
  type: 'spring'
  stiffness: number
  damping: number
  delay?: number
}

const springSnappy: SpringTransition = {
  type: 'spring',
  stiffness: 350,
  damping: 30,
}

const springGentle: SpringTransition = {
  type: 'spring',
  stiffness: 200,
  damping: 24,
}

const springBouncy: SpringTransition = {
  type: 'spring',
  stiffness: 400,
  damping: 20,
}

function staggerDelay(index: number, base = 0.04): number {
  return index * base
}

function staggeredSpring(index: number, base = 0.04): SpringTransition {
  return {
    ...springSnappy,
    delay: staggerDelay(index, base),
  }
}

export function useMotionPresets() {
  return {
    springSnappy,
    springGentle,
    springBouncy,
    staggerDelay,
    staggeredSpring,
  }
}
