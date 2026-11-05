export const LEARN_ADAPTIVE_SURFACE = [
  'learn-adaptive-surface',
  'motion-reduce:animate-none! motion-reduce:[transition:none]! motion-reduce:**:animate-none! motion-reduce:**:[transition:none]!',
  '[&_:is(input,select,textarea,[contenteditable=true])]:scroll-my-4',
  '[&_[data-slot=sheet-close]]:flex [&_[data-slot=sheet-close]]:min-h-11 [&_[data-slot=sheet-close]]:min-w-11 [&_[data-slot=sheet-close]]:items-center [&_[data-slot=sheet-close]]:justify-center',
  'forced-colors:[&_:is(a[href],button,input,select,textarea,[tabindex]):focus-visible]:[outline:2px_solid_Highlight]',
  'forced-colors:[&_:is(a[href],button,input,select,textarea,[tabindex]):focus-visible]:[outline-offset:2px]',
  'forced-colors:[&_:is(a[href],button,input,select,textarea,[tabindex]):focus-visible]:[box-shadow:none]',
].join(' ')
