# --- Stage 1: Builder ---
# Use the official Node.js 18 image from the Amazon ECR Public Gallery as a fallback for Docker Hub.
FROM public.ecr.aws/docker/library/node:18-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker layer caching.
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy the rest of the application source code
COPY . .

# --- Stage 2: Production ---
# Use the same reliable base image for the final, slim production image.
FROM public.ecr.aws/docker/library/node:18-alpine

WORKDIR /app

# Set Node.js to production mode
ENV NODE_ENV=production
# The port is set at runtime by the hosting platform, but we can set a default.
ENV PORT=8080

# Copy dependencies and application code from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/index.js ./index.js
COPY --from=builder /app/package.json ./package.json

EXPOSE $PORT

# Run the application
CMD ["node", "index.js"]

