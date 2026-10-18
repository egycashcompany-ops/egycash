// The machine map's stroke icons (24 × 24 paths, `StrokeIcon`), from the approved mockups.
export const MAP_ICON = {
  pin: [
    'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z',
    'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  ],
  zones: ['M4 7l6-3 6 3 4-2v13l-4 2-6-3-6 3z', 'M10 4v13M16 7v13'],
  outside: ['M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z'],
  pencil: ['M4 20h4L19 9l-4-4L4 16z'],
  status: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M9 12l2 2 4-4'],
  locate: ['M12 3v3M12 18v3M3 12h3M18 12h3', 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z'],
  zone: ['M12 3l8 6-3 10H7L4 9z'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-3.5-3.5'],
} as const;
