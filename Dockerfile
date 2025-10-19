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
    # Git is required for fetching some dependencies from GitHub
    git \
    # Install fonts for wordcloud and watermark support
    fonts-lato \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Copy the dependency manifest
COPY package.json ./

# Force git to use https instead of ssh, a common fix for CI/CD environments
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

# Install dependencies using Yarn. This will generate a new yarn.lock file.
# --production skips developer-only packages
RUN yarn install --production

# Bundle the application source code into the image
COPY . .

# Expose the port the app runs on
EXPOSE 3400

# Define the command to run your app
CMD [ "node", "index.js" ]
