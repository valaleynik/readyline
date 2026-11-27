/** @type {import('next').NextConfig} */
export default {
  // The app imports the engine from ../src so there is exactly one copy of it.
  experimental: { externalDir: true },
};
