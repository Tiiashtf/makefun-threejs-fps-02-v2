// Movement physics for one body (player or bot): a capsule on AABB ground.
// Acceleration and friction give it weight; gravity pulls it down; a step-up
// of 0.45 m lets it walk up stairs and ramps; axis-separated collision keeps
// it out of walls. The caller owns yaw/pitch; the mover only translates.
import * as THREE from 'three';

const STEP_UP = 0.45;
const GRAVITY = 22;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 7.4;
const CROUCH_SPEED = 2.8;
const ACCEL = 42;
const AIR_ACCEL = 12;
const FRICTION = 10;

export function createBody(map, opts) {
  const body = {
    position: new THREE.Vector3(opts.x, opts.y ?? map.groundAt(opts.x, opts.z), opts.z),
    velocity: new THREE.Vector3(),
    yaw: opts.yaw ?? 0,
    radius: opts.radius ?? 0.4,
    height: opts.height ?? 1.7,
    crouchHeight: opts.crouchHeight ?? 1.1,
    crouched: false,
    onGround: true,
  };

  function collidesAt(x, z, feetY, height) {
    const r = body.radius;
    for (const s of map.solids) {
      // Vertical overlap: the solid blocks only if the body cannot step onto it.
      if (feetY + height <= s.y0 || feetY >= s.y1 - STEP_UP) continue;
      if (x + r > s.x0 && x - r < s.x1 && z + r > s.z0 && z - r < s.z1) return true;
    }
    return false;
  }

  // Move one fixed step. input: { forward, strafe (-1..1), jump, sprint, crouch, wishYaw }.
  function step(dt, input) {
    const speed = input.crouch ? CROUCH_SPEED : input.sprint ? SPRINT_SPEED : WALK_SPEED;
    body.crouched = !!input.crouch;
    const height = body.crouched ? body.crouchHeight : body.height;
    const sin = Math.sin(body.yaw);
    const cos = Math.cos(body.yaw);
    // Wish direction in world space (yaw 0 faces -z).
    const wishX = -sin * input.forward + cos * input.strafe;
    const wishZ = -cos * input.forward - sin * input.strafe;
    const wishLen = Math.hypot(wishX, wishZ);
    const accel = body.onGround ? ACCEL : AIR_ACCEL;
    if (wishLen > 0.01) {
      body.velocity.x += (wishX / wishLen) * accel * dt;
      body.velocity.z += (wishZ / wishLen) * accel * dt;
      // Cap horizontal speed at the wish speed.
      const hs = Math.hypot(body.velocity.x, body.velocity.z);
      if (hs > speed) {
        body.velocity.x *= speed / hs;
        body.velocity.z *= speed / hs;
      }
    } else if (body.onGround) {
      const f = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= f;
      body.velocity.z *= f;
      if (Math.abs(body.velocity.x) < 0.02) body.velocity.x = 0;
      if (Math.abs(body.velocity.z) < 0.02) body.velocity.z = 0;
    }

    if (input.jump && body.onGround) {
      body.velocity.y = 7.6;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    // Axis-separated move: x first, then z, so walls slide instead of stop.
    const nx = body.position.x + body.velocity.x * dt;
    if (!collidesAt(nx, body.position.z, body.position.y, height)) body.position.x = nx;
    const nz = body.position.z + body.velocity.z * dt;
    if (!collidesAt(body.position.x, nz, body.position.y, height)) body.position.z = nz;

    // Vertical: ground is the highest solid top under the body that is not
    // above the step-up, else the yard floor at 0.
    const ground = map.groundAt(body.position.x, body.position.z);
    let feetY = body.position.y + body.velocity.y * dt;
    if (body.velocity.y <= 0 && feetY <= ground) {
      feetY = ground;
      body.velocity.y = 0;
      body.onGround = true;
    } else {
      body.onGround = false;
    }
    // Step up: walking into a low top lifts the body onto it.
    if (body.onGround && ground > body.position.y && ground - body.position.y <= STEP_UP) {
      feetY = ground;
    }
    body.position.y = feetY;
    // Keep inside the yard.
    body.position.x = Math.max(-31.5, Math.min(31.5, body.position.x));
    body.position.z = Math.max(-23.5, Math.min(23.5, body.position.z));
  }

  return { body, step, collidesAt };
}
