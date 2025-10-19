# Quickchart
- [GH](https://github.com/typpo/quickchart)
- [Web](https://quickchart.io/)

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/kaerez/heroku-quickchart)

Of course. Here is the documentation for the new authentication and rate-limiting enhancement.

````markdown
### Authentication and Rate-Limiting Enhancement

This server now includes a dynamic, key-based authentication and rate-limiting system. This system replaces the previous simple IP-based rate limiter with a more granular, key-centric approach. All configuration is managed through Heroku environment variables.

---

### 1. Authentication

Authentication is now managed by a set of API keys you define. If at least one key is defined, all API endpoints (`/chart`, `/qr`, etc.) will require a valid key.

#### How to Define Keys

You define keys using environment variables with the syntax `authn[x]`, where `x` is a number from 0 to 9999.

**Example Heroku Config Vars:**
| KEY | VALUE |
| :--- | :--- |
| `authn[0]` | `first-secret-key-for-user-a` |
| `authn[1]` | `another-key-for-user-b` |

#### How to Authenticate a Request

A client must provide their key in one of two ways:

1.  **Authorization Header (Recommended):**
    ```
    Authorization: Bearer <your-api-key>
    ```

2.  **Query Parameter:**
    ```
    /chart?c={...}&key=<your-api-key>
    ```

---

### 2. Rate Limiting

The rate-limiting system is now tied directly to each API key (or to anonymous users as a group). IP addresses are no longer used for rate limiting.

#### How to Define Limits

You define limits using environment variables with the syntax `limit[x]` or `limita`.

* `limit[x]`: The `x` in `limit[x]` **must** correspond to the `x` in an `authn[x]` key. This rule set applies only to the user with that specific key.
* `limita`: This special variable applies a single, shared rate limit to **all unauthenticated (anonymous) requests**.

#### Limit Syntax

The value of a limit variable is a comma-separated string containing one or more of the following:

* `rps:[n]`: Requests per second.
* `rpm:[n]`: Requests per minute.
* `rph:[n]`: Requests per hour.
* `rpd:[n]`: Requests per day.

**Important:** Setting any limit to `0` (e.g., `rps:0`) will block all requests for that key or for anonymous users. To have no limit for a specific time window, simply omit it from the string.

#### Example Heroku Config Vars:

| KEY | VALUE | DESCRIPTION |
| :--- | :--- | :--- |
| `authn[0]` | `user-a-key` | Key for User A. |
| `limit[0]` | `rpm:60,rpd:1000` | User A can make 60 requests/minute and 1000/day. |
| `authn[1]` | `user-b-key` | Key for User B. |
| `limit[1]` | `rps:1` | User B can make 1 request/second (no other limits apply). |
| `authn[2]` | `blocked-user-key` | Key for a blocked user. |
| `limit[2]` | `rps:0` | User with this key cannot make any requests. |
| `limita` | `rph:100` | All anonymous users share a pool of 100 requests/hour. |
````
