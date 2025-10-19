# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Install system dependencies required for chart generation and extra features
# This includes build tools, and libraries for graphics (cairo, pango, etc.)
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    # -- ADDED TO FIX GIT-BASED NPM DEPENDENCIES --
    git \
    # -- ADDED FOR WORDCLOUD & WATERMARK SUPPORT --
    # Install a common set of fonts used by wordcloud and watermarking.
    fonts-lato \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and yarn.lock
COPY package*.json ./
COPY yarn.lock ./

# -- CORRECTED TO FIX SSH AUTHENTICATION ERROR --
# Force git to use https instead of the ssh protocol for github dependencies
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

# Install app dependencies using the --legacy-peer-deps flag to resolve conflicts
# and the modern --omit=dev flag instead of --production.
RUN npm install --omit=dev --legacy-peer-deps

# -- ADDED TO FIX VULNERABILITIES --
# Attempt to fix known security vulnerabilities, forcing updates where possible.
RUN npm audit fix --force

# Bundle app source
COPY . .

# Expose the port the app runs on
EXPOSE 3400

# Define the command to run your app
CMD [ "node", "index.js" ]

