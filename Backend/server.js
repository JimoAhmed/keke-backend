// backend/server.js - COMPLETE WITH MOBILE CONFIG ENDPOINT AND KEKE-POOL
const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

function getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}

const LOCAL_IP = getNetworkIP();
const FRONTEND_DIR = path.join(__dirname, '../Frontend');
const HAS_FRONTEND = fs.existsSync(FRONTEND_DIR);

app.use(cors());
app.use(express.json());
if (HAS_FRONTEND) {
    app.use(express.static(FRONTEND_DIR));
}

app.use((req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    res.locals.isMobile = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    next();
});

// ============================================
// VEHICLE DATABASE
// ============================================

let vehicles = [
    { id:1, name:"Tricycle #001", type:"tricycle", lat:6.89277, lng:3.71827, available:true, battery:92, maxCapacity:4, passengerCount:0, color:"Blue", lastUpdate:new Date().toISOString(), driver:"John Okafor", phone:"+234 803 123 4567", speed:15, rating:4.8, tripsToday:12, reservedForPool:false, poolId:null },
    { id:2, name:"Tricycle #002", type:"tricycle", lat:6.89509, lng:3.72761, available:true, battery:78, maxCapacity:4, passengerCount:0, color:"Red", lastUpdate:new Date().toISOString(), driver:"Michael Obi", phone:"+234 803 234 5678", speed:12, rating:4.6, tripsToday:8, reservedForPool:false, poolId:null },
    { id:3, name:"Tricycle #003", type:"tricycle", lat:6.89286, lng:3.72351, available:true, battery:65, maxCapacity:4, passengerCount:0, color:"Green", lastUpdate:new Date().toISOString(), driver:"Sunday Eze", phone:"+234 803 345 6789", speed:10, rating:4.9, tripsToday:15, reservedForPool:false, poolId:null },
    { id:4, name:"Tricycle #004", type:"tricycle", lat:6.88884, lng:3.72281, available:true, battery:85, maxCapacity:4, passengerCount:0, color:"Yellow", lastUpdate:new Date().toISOString(), driver:"Chidi Nwosu", phone:"+234 803 456 7890", speed:14, rating:4.7, tripsToday:10, reservedForPool:false, poolId:null },
    { id:5, name:"Tricycle #005", type:"tricycle", lat:6.89069, lng:3.72622, available:true, battery:45, maxCapacity:4, passengerCount:0, color:"Blue", lastUpdate:new Date().toISOString(), driver:"Emeka Okonkwo", phone:"+234 803 567 8901", speed:11, rating:4.5, tripsToday:6, reservedForPool:false, poolId:null },
    { id:6, name:"Tricycle #006", type:"tricycle", lat:6.89471, lng:3.72230, available:true, battery:88, maxCapacity:4, passengerCount:0, color:"Red", lastUpdate:new Date().toISOString(), driver:"Ifeanyi Ade", phone:"+234 803 678 9012", speed:13, rating:4.8, tripsToday:14, reservedForPool:false, poolId:null }
];

let rideReservations = [];

// ============================================
// KEKE-POOL SYSTEM
// ============================================

let kekePools = [];

class KekePool {
    constructor(destinationName, destinationLat, destinationLng, vehicleId) {
        this.id = `pool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.destination = { name:destinationName, lat:destinationLat, lng:destinationLng };
        this.riders = [];
        this.maxRiders = 4;
        this.createdAt = new Date().toISOString();
        this.status = 'waiting';
        this.assignedVehicle = null;
        this.optimizedRoute = null;
        this.syncState = null;
        this.vehicleId = vehicleId;

        // FIXED: Lock the vehicle for pool mode as soon as the pool is created
        // so the frontend can immediately show it as "Pool Only"
        this.lockVehicleForPool();
    }

    lockVehicleForPool() {
        if (!this.vehicleId) return;
        const vIdx = vehicles.findIndex(v => v.id === this.vehicleId);
        if (vIdx !== -1) {
            vehicles[vIdx].reservedForPool = true;
            vehicles[vIdx].poolId = this.id;
            // Keep available:true while waiting so pool riders can still join
            // but solo booking is blocked because reservedForPool is true
            vehicles[vIdx].lastUpdate = new Date().toISOString();
        }
    }

    // FIXED: Accept the frontend-provided riderId so IDs are consistent across client/server
    addRider(rider) {
        if (this.riders.length < this.maxRiders) {
            this.riders.push({
                id: rider.id || `rider_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                name: rider.name,
                pickupLat: rider.pickupLat,
                pickupLng: rider.pickupLng,
                joinedAt: new Date().toISOString()
            });

            // Update vehicle passenger count as riders join
            const vIdx = vehicles.findIndex(v => v.id === this.vehicleId);
            if (vIdx !== -1) {
                vehicles[vIdx].passengerCount = this.riders.length;
                vehicles[vIdx].lastUpdate = new Date().toISOString();
            }

            if (this.riders.length >= this.maxRiders) {
                this.status = 'ready';
                this.assignOptimalVehicle();
            }
            return true;
        }
        return false;
    }

    assignOptimalVehicle() {
        if (!this.vehicleId) return;
        this.assignedVehicle = vehicles.find(v => v.id === this.vehicleId);
        if (this.assignedVehicle) {
            this.calculateOptimizedRoute();
            this.buildSynchronizedPlan();
            const vIdx = vehicles.findIndex(v => v.id === this.vehicleId);
            if (vIdx !== -1) {
                vehicles[vIdx].reservedForPool = true;
                vehicles[vIdx].poolId = this.id;
                vehicles[vIdx].available = false; // Now fully locked — no more riders
                vehicles[vIdx].lastUpdate = new Date().toISOString();
            }
        }
    }

    calculateOptimizedRoute() {
        if (!this.assignedVehicle) return;
        let currentPoint = { lat:this.assignedVehicle.lat, lng:this.assignedVehicle.lng };

        const ridersWithDistance = this.riders.map(rider => {
            const distance = calculateDistance(this.assignedVehicle.lat, this.assignedVehicle.lng, rider.pickupLat, rider.pickupLng);
            return { ...rider, distance };
        });
        ridersWithDistance.sort((a, b) => a.distance - b.distance);

        let totalTime = 0;
        const estimatedPickupOrder = ridersWithDistance.map((rider, index) => {
            const distance = calculateDistance(currentPoint.lat, currentPoint.lng, rider.pickupLat, rider.pickupLng);
            const time = (distance / (this.assignedVehicle.speed || 12)) * 60;
            totalTime += time;
            currentPoint = { lat: rider.pickupLat, lng: rider.pickupLng };
            return { ...rider, pickupOrder: index + 1, eta: Math.max(1, Math.ceil(time)) };
        });

        const finalDistance = calculateDistance(currentPoint.lat, currentPoint.lng, this.destination.lat, this.destination.lng);
        totalTime += (finalDistance / (this.assignedVehicle.speed || 12)) * 60;

        this.optimizedRoute = {
            vehicle: this.assignedVehicle,
            destination: this.destination,
            estimatedPickupOrder,
            totalTime: Math.ceil(totalTime)
        };
    }

    buildSynchronizedPlan() {
        if (!this.assignedVehicle || !this.optimizedRoute) return;

        const nowMs = Date.now();
        const rideStartMs = nowMs + 2000;
        const speed = this.assignedVehicle.speed || 12;
        const riders = this.riders || [];
        if (riders.length === 0) return;

        const SAME_LOCATION_THRESHOLD_KM = 0.02;
        const first = riders[0];
        const samePickupLocation = riders.every(r =>
            calculateDistance(r.pickupLat, r.pickupLng, first.pickupLat, first.pickupLng) <= SAME_LOCATION_THRESHOLD_KM
        );

        let pickupPlan = [];
        let totalTimeMinutes = this.optimizedRoute.totalTime || 0;

        if (samePickupLocation) {
            const distToShared = calculateDistance(
                this.assignedVehicle.lat, this.assignedVehicle.lng,
                first.pickupLat, first.pickupLng
            );
            const sharedPickupEta = Math.max(1, Math.ceil((distToShared / speed) * 60));
            const distToDest = calculateDistance(
                first.pickupLat, first.pickupLng,
                this.destination.lat, this.destination.lng
            );
            const toDestination = Math.max(1, Math.ceil((distToDest / speed) * 60));
            totalTimeMinutes = sharedPickupEta + toDestination;

            pickupPlan = riders.map((r, index) => ({
                riderId: r.id,
                riderName: r.name,
                pickupOrder: index + 1,
                legEtaMinutes: sharedPickupEta,
                cumulativeETA: sharedPickupEta,
                etaAt: new Date(rideStartMs + sharedPickupEta * 60000).toISOString(),
                pickupLat: r.pickupLat,
                pickupLng: r.pickupLng
            }));

            this.optimizedRoute = {
                ...this.optimizedRoute,
                mode: 'group',
                estimatedPickupOrder: pickupPlan.map(p => ({
                    id: p.riderId,
                    name: p.riderName,
                    pickupLat: p.pickupLat,
                    pickupLng: p.pickupLng,
                    pickupOrder: p.pickupOrder,
                    eta: p.legEtaMinutes,
                    cumulativeETA: p.cumulativeETA
                })),
                sharedPickupETA: sharedPickupEta,
                totalTime: totalTimeMinutes
            };
        } else {
            let cumulative = 0;
            const existingOrder = this.optimizedRoute.estimatedPickupOrder || [];
            pickupPlan = existingOrder.map((r, index) => {
                const legEta = Math.max(1, parseInt(r.eta, 10) || 1);
                cumulative += legEta;
                return {
                    riderId: r.id,
                    riderName: r.name,
                    pickupOrder: r.pickupOrder || (index + 1),
                    legEtaMinutes: legEta,
                    cumulativeETA: cumulative,
                    etaAt: new Date(rideStartMs + cumulative * 60000).toISOString(),
                    pickupLat: r.pickupLat,
                    pickupLng: r.pickupLng
                };
            });

            this.optimizedRoute = {
                ...this.optimizedRoute,
                mode: 'staggered',
                estimatedPickupOrder: pickupPlan.map(p => ({
                    id: p.riderId,
                    name: p.riderName,
                    pickupLat: p.pickupLat,
                    pickupLng: p.pickupLng,
                    pickupOrder: p.pickupOrder,
                    eta: p.legEtaMinutes,
                    cumulativeETA: p.cumulativeETA
                }))
            };
        }

        this.syncState = {
            generatedAt: new Date(nowMs).toISOString(),
            rideStartAt: new Date(rideStartMs).toISOString(),
            samePickupLocation,
            totalTimeMinutes,
            estimatedArrivalAt: new Date(rideStartMs + totalTimeMinutes * 60000).toISOString(),
            pickupPlan
        };
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calculateETA(distanceKm, speedKmh = 12) {
    return (distanceKm / speedKmh) * 60;
}

// ============================================
// API ROUTES
// ============================================

app.get('/', (req, res) => {
    if (HAS_FRONTEND) return res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
    return res.json({ service: 'keke-backend', status: 'ok' });
});

app.get('/navigator', (req, res) => {
    if (HAS_FRONTEND) return res.sendFile(path.join(FRONTEND_DIR, 'navigator.html'));
    return res.status(404).json({ error: 'Navigator frontend is not deployed on this service' });
});

app.get('/api/mobile/config', (req, res) => {
    res.json({
        isMobile: res.locals.isMobile, serverTime: new Date().toISOString(),
        networkIP: LOCAL_IP, port: PORT,
        mapDefaultZoom: res.locals.isMobile ? 16 : 17,
        gestureHandling: res.locals.isMobile ? 'greedy' : 'auto',
        refreshInterval: res.locals.isMobile ? 30000 : 60000,
        apiEndpoint: `http://${LOCAL_IP}:${PORT}`,
        features: { streetView: !res.locals.isMobile, mapTypeControl: !res.locals.isMobile, fullscreenControl: true, geolocation: true }
    });
});

app.get('/api/vehicles', (req, res) => res.json(vehicles));

app.get('/api/vehicles/available', (req, res) => {
    res.json(vehicles.filter(v => v.available === true && v.passengerCount < v.maxCapacity && !v.reservedForPool));
});

// FIXED: nearby now includes reservedForPool in response so frontend can show "Pool Only" badge
app.get('/api/vehicles/nearby', (req, res) => {
    const { lat, lng, radius = 2 } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'Missing lat/lng parameters' });

    const userLat = parseFloat(lat), userLng = parseFloat(lng), maxDistance = parseFloat(radius);

    // FIXED: Include pool-locked vehicles in the list (just disabled for solo)
    // so riders can see them and select Keke-Pool mode on them
    const nearbyVehicles = vehicles
        .filter(v => v.passengerCount < v.maxCapacity) // show all non-full vehicles
        .map(v => {
            const distance = calculateDistance(userLat, userLng, v.lat, v.lng);
            const eta = calculateETA(distance, v.speed || 12);
            return {
                id: v.id, name: v.name, lat: v.lat, lng: v.lng,
                distance: parseFloat(distance.toFixed(2)),
                eta: Math.max(1, Math.ceil(eta)),
                battery: v.battery, color: v.color, type: v.type,
                passengerCount: v.passengerCount, maxCapacity: v.maxCapacity,
                availableSeats: v.maxCapacity - v.passengerCount,
                driver: v.driver, phone: v.phone, rating: v.rating,
                available: v.available,
                reservedForPool: v.reservedForPool, // FIXED: always expose this field
                poolId: v.poolId,
                lastUpdate: v.lastUpdate
            };
        })
        .filter(v => v.distance <= maxDistance)
        .sort((a, b) => a.distance - b.distance);

    res.json(nearbyVehicles);
});

app.get('/api/vehicles/:id', (req, res) => {
    const vehicle = vehicles.find(v => v.id == req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
});

app.post('/api/rides/calculate-eta', (req, res) => {
    const { pickupLat, pickupLng, destLat, destLng, vehicleId } = req.body;
    if (!pickupLat || !pickupLng || !destLat || !destLng || !vehicleId)
        return res.status(400).json({ error: 'Missing required parameters' });
    const vehicle = vehicles.find(v => v.id == vehicleId);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle.reservedForPool) return res.status(400).json({ error:'This tricycle is reserved for a Keke-Pool and cannot be booked solo', reservedForPool:true, poolId:vehicle.poolId });
    if (vehicle.passengerCount >= vehicle.maxCapacity) return res.status(400).json({ error:'Vehicle is full', passengerCount:vehicle.passengerCount, maxCapacity:vehicle.maxCapacity });
    const pickupDistance = calculateDistance(parseFloat(pickupLat), parseFloat(pickupLng), vehicle.lat, vehicle.lng);
    const tripDistance = calculateDistance(parseFloat(pickupLat), parseFloat(pickupLng), parseFloat(destLat), parseFloat(destLng));
    const spd = vehicle.speed || 12;
    const pickupETA = Math.max(2, Math.ceil((pickupDistance/spd)*60));
    const tripETA = Math.max(3, Math.ceil((tripDistance/spd)*60));
    res.json({
        pickupETA, tripETA, totalETA: pickupETA+tripETA,
        pickupDistance: parseFloat(pickupDistance.toFixed(2)), tripDistance: parseFloat(tripDistance.toFixed(2)),
        pickupDistanceText:`${pickupDistance.toFixed(1)} km`, tripDistanceText:`${tripDistance.toFixed(1)} km`,
        pickupDurationText:`${pickupETA} min`, tripDurationText:`${tripETA} min`,
        assignedVehicle: { id:vehicle.id, name:vehicle.name, driver:vehicle.driver, phone:vehicle.phone, color:vehicle.color, passengerCount:vehicle.passengerCount, maxCapacity:vehicle.maxCapacity, availableSeats:vehicle.maxCapacity-vehicle.passengerCount, rating:vehicle.rating, reservedForPool:vehicle.reservedForPool }
    });
});

app.post('/api/vehicles/:id/reserve', (req, res) => {
    const { id } = req.params;
    const { userName, pickupLat, pickupLng, destLat, destLng } = req.body;
    const vIdx = vehicles.findIndex(v => v.id == id);
    if (vIdx === -1) return res.status(404).json({ error:'Vehicle not found' });
    const vehicle = vehicles[vIdx];
    if (vehicle.reservedForPool) return res.status(400).json({ error:'This tricycle is reserved for a Keke-Pool and cannot be booked solo', reservedForPool:true, poolId:vehicle.poolId });
    if (vehicle.passengerCount >= vehicle.maxCapacity) return res.status(400).json({ error:'Vehicle is full', passengerCount:vehicle.passengerCount, maxCapacity:vehicle.maxCapacity });
    if (!vehicle.available) return res.status(400).json({ error:'Vehicle is already reserved' });
    vehicles[vIdx].passengerCount += 1;
    if (vehicles[vIdx].passengerCount >= vehicles[vIdx].maxCapacity) vehicles[vIdx].available = false;
    vehicles[vIdx].reservedAt = new Date().toISOString();
    vehicles[vIdx].reservedBy = userName || "Guest";
    vehicles[vIdx].lastUpdate = new Date().toISOString();
    const reservationId = `RIDE_${Date.now()}_${id}`;
    const expiryTime = new Date(Date.now() + 15*60000);
    const reservation = {
        id: reservationId, vehicleId: parseInt(id), vehicleName: vehicle.name,
        vehicleDetails: { driver:vehicle.driver, phone:vehicle.phone, color:vehicle.color, rating:vehicle.rating },
        userName: userName||"Guest", passengerCount: vehicles[vIdx].passengerCount,
        pickupLocation: { lat:parseFloat(pickupLat), lng:parseFloat(pickupLng) },
        destination: { lat:parseFloat(destLat), lng:parseFloat(destLng) },
        status:"reserved", reservedAt:new Date().toISOString(), expiresAt:expiryTime.toISOString()
    };
    rideReservations.push(reservation);
    res.json({ success:true, message:'Vehicle reserved successfully', reservationId, expiryTime:expiryTime.toISOString(), passengerCount:vehicles[vIdx].passengerCount, availableSeats:vehicle.maxCapacity-vehicles[vIdx].passengerCount, vehicleDetails:{ driver:vehicle.driver, phone:vehicle.phone } });
});

app.post('/api/vehicles/:id/release', (req, res) => {
    const vIdx = vehicles.findIndex(v => v.id == req.params.id);
    if (vIdx === -1) return res.status(404).json({ error:'Vehicle not found' });
    if (vehicles[vIdx].passengerCount > 0) vehicles[vIdx].passengerCount -= 1;
    if (vehicles[vIdx].passengerCount < vehicles[vIdx].maxCapacity) {
        vehicles[vIdx].available = true;
        vehicles[vIdx].reservedBy = null;
    }
    vehicles[vIdx].lastUpdate = new Date().toISOString();
    res.json({ success:true, message:'Vehicle released', passengerCount:vehicles[vIdx].passengerCount, available:vehicles[vIdx].available });
});

app.post('/api/vehicles/:id/complete-ride', (req, res) => {
    const vIdx = vehicles.findIndex(v => v.id == req.params.id);
    if (vIdx === -1) return res.status(404).json({ error:'Vehicle not found' });
    vehicles[vIdx].passengerCount = 0;
    vehicles[vIdx].available = true;
    vehicles[vIdx].reservedForPool = false;
    vehicles[vIdx].poolId = null;
    vehicles[vIdx].reservedBy = null;
    vehicles[vIdx].lastUpdate = new Date().toISOString();
    const reservation = rideReservations.find(r => r.vehicleId == req.params.id && r.status==='reserved');
    if (reservation) { reservation.status='completed'; reservation.completedAt=new Date().toISOString(); }
    res.json({ success:true, message:'Ride completed', passengerCount:0, available:true });
});

app.get('/api/reservations/:id', (req, res) => {
    const reservation = rideReservations.find(r => r.id === req.params.id);
    if (!reservation) return res.status(404).json({ error:'Reservation not found' });
    const now = new Date(), expiry = new Date(reservation.expiresAt);
    const vehicle = vehicles.find(v => v.id == reservation.vehicleId);
    res.json({ ...reservation, vehicleDetails: vehicle?{ driver:vehicle.driver, phone:vehicle.phone, currentLocation:{lat:vehicle.lat,lng:vehicle.lng}, battery:vehicle.battery, reservedForPool:vehicle.reservedForPool }:null, isValid:now<=expiry, expiresIn:Math.max(0,Math.floor((expiry-now)/60000)) });
});

// ============================================
// KEKE-POOL API ENDPOINTS
// ============================================

app.get('/api/kekepool/status', (req, res) => {
    const { destination } = req.query;
    if (!destination) return res.status(400).json({ error:'Destination required' });
    const existingPool = kekePools.find(p => p.destination.name===destination && p.status==='waiting' && p.riders.length<p.maxRiders);
    if (existingPool) {
        res.json({
            serverTime: new Date().toISOString(),
            exists: true,
            group: {
                id:existingPool.id,
                destination:existingPool.destination,
                riders:existingPool.riders,
                maxRiders:existingPool.maxRiders,
                spotsLeft:existingPool.maxRiders-existingPool.riders.length,
                createdAt:existingPool.createdAt,
                vehicleId:existingPool.vehicleId,
                syncState: existingPool.syncState
            }
        });
    } else {
        res.json({ serverTime: new Date().toISOString(), exists: false });
    }
});

// FIXED: Accept frontend riderId, require vehicleId, lock vehicle immediately
app.post('/api/kekepool/join', (req, res) => {
    const { poolId, riderId, userName, pickupLat, pickupLng, destinationName, destinationLat, destinationLng, vehicleId } = req.body;

    // FIXED: vehicleId is required — frontend must send which tricycle the pool is for
    if (!userName || !pickupLat || !pickupLng || !destinationName || !destinationLat || !destinationLng) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields',
            required: ['userName', 'pickupLat', 'pickupLng', 'destinationName', 'destinationLat', 'destinationLng'],
            received: Object.keys(req.body)
        });
    }

    let pool;

    if (poolId) {
        pool = kekePools.find(p => p.id === poolId);
        if (!pool) return res.status(404).json({ success:false, error:'Pool not found' });
        if (pool.status !== 'waiting') return res.status(400).json({ success:false, error:'Pool is no longer accepting riders' });
    } else {
        // Create new pool — vehicleId required for new pools
        if (!vehicleId) {
            return res.status(400).json({ success:false, error:'vehicleId is required to create a new pool' });
        }
        const vehicle = vehicles.find(v => v.id == vehicleId);
        if (!vehicle) return res.status(404).json({ success:false, error:'Vehicle not found' });
        if (vehicle.passengerCount >= vehicle.maxCapacity) return res.status(400).json({ success:false, error:'Vehicle is full' });

        pool = new KekePool(destinationName, parseFloat(destinationLat), parseFloat(destinationLng), parseInt(vehicleId));
        kekePools.push(pool);
    }

    // FIXED: Pass frontend riderId so client and server stay in sync
    const rider = {
        id: riderId || `rider_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: userName,
        pickupLat: parseFloat(pickupLat),
        pickupLng: parseFloat(pickupLng)
    };

    const added = pool.addRider(rider);
    if (!added) return res.status(400).json({ success:false, error:'Pool is full' });

    // If pool is now ready, create group reservation
    if (pool.status === 'ready') {
        const groupReservationId = `POOL_${Date.now()}`;
        const expiryTime = new Date(Date.now() + 15*60000);
        rideReservations.push({
            id: groupReservationId, type:'keke-pool', poolId:pool.id,
            destination:pool.destination, riders:pool.riders,
            vehicleId:pool.assignedVehicle?.id,
            vehicleDetails: pool.assignedVehicle ? { id:pool.assignedVehicle.id, name:pool.assignedVehicle.name, driver:pool.assignedVehicle.driver, phone:pool.assignedVehicle.phone, lat:pool.assignedVehicle.lat, lng:pool.assignedVehicle.lng, speed:pool.assignedVehicle.speed } : null,
            optimizedRoute:pool.optimizedRoute, status:'ready',
            expiresAt:expiryTime.toISOString(), createdAt:new Date().toISOString()
        });
        return res.json({
            serverTime: new Date().toISOString(),
            success: true,
            message: 'Pool is ready! Simulation will start.',
            pool: { id:pool.id, status:pool.status, riders:pool.riders, maxRiders:pool.maxRiders, spotsLeft:0, vehicleId:pool.vehicleId, syncState:pool.syncState },
            reservation: { id:groupReservationId, vehicle:pool.assignedVehicle, optimizedRoute:pool.optimizedRoute, totalTime:pool.optimizedRoute?.totalTime, syncState:pool.syncState }
        });
    }

    res.json({
        serverTime: new Date().toISOString(),
        success: true,
        message: `Joined pool. Waiting for ${pool.maxRiders - pool.riders.length} more rider(s).`,
        pool: { id:pool.id, status:pool.status, riders:pool.riders, maxRiders:pool.maxRiders, spotsLeft:pool.maxRiders-pool.riders.length, vehicleId:pool.vehicleId, syncState:pool.syncState }
    });
});

app.get('/api/kekepool/:poolId', (req, res) => {
    const pool = kekePools.find(p => p.id === req.params.poolId);
    if (!pool) return res.status(404).json({ error:'Pool not found' });
    res.json({
        serverTime: new Date().toISOString(),
        id:pool.id, destination:pool.destination, riders:pool.riders, maxRiders:pool.maxRiders,
        spotsLeft:pool.maxRiders-pool.riders.length, status:pool.status, createdAt:pool.createdAt,
        vehicleId:pool.vehicleId,
        assignedVehicle: pool.assignedVehicle ? { id:pool.assignedVehicle.id, name:pool.assignedVehicle.name, driver:pool.assignedVehicle.driver, phone:pool.assignedVehicle.phone, lat:pool.assignedVehicle.lat, lng:pool.assignedVehicle.lng, speed:pool.assignedVehicle.speed } : null,
        optimizedRoute:pool.optimizedRoute,
        syncState: pool.syncState
    });
});

app.post('/api/kekepool/:poolId/leave', (req, res) => {
    const { riderId } = req.body;
    const poolIdx = kekePools.findIndex(p => p.id === req.params.poolId);
    if (poolIdx === -1) return res.status(404).json({ error:'Pool not found' });
    const pool = kekePools[poolIdx];
    if (pool.status !== 'waiting') return res.status(400).json({ error:'Cannot leave pool that is already ready or in progress' });
    pool.riders = pool.riders.filter(r => r.id !== riderId);
    const vIdx = vehicles.findIndex(v => v.id === pool.vehicleId);
    if (vIdx !== -1) {
        vehicles[vIdx].passengerCount = pool.riders.length;
        vehicles[vIdx].lastUpdate = new Date().toISOString();
    }
    if (pool.riders.length === 0) {
        if (vIdx !== -1) {
            vehicles[vIdx].reservedForPool = false;
            vehicles[vIdx].poolId = null;
            vehicles[vIdx].available = true;
            vehicles[vIdx].passengerCount = 0;
            vehicles[vIdx].lastUpdate = new Date().toISOString();
        }
        kekePools.splice(poolIdx, 1);
        return res.json({ success:true, message:'Pool deleted (no riders left)' });
    }
    res.json({ success:true, message:'Left pool', pool:{ id:pool.id, riders:pool.riders, spotsLeft:pool.maxRiders-pool.riders.length } });
});

app.post('/api/kekepool/:poolId/start', (req, res) => {
    const pool = kekePools.find(p => p.id === req.params.poolId);
    if (!pool) return res.status(404).json({ error:'Pool not found' });
    if (pool.riders.length < pool.maxRiders) return res.status(400).json({ error:'Pool is not full yet' });
    pool.status = 'in_progress';
    if (pool.assignedVehicle) {
        const vIdx = vehicles.findIndex(v => v.id === pool.assignedVehicle.id);
        if (vIdx !== -1) { vehicles[vIdx].available=false; vehicles[vIdx].reservedForPool=true; vehicles[vIdx].lastUpdate=new Date().toISOString(); }
    }
    res.json({ success:true, message:'Pool ride started', pool:{ id:pool.id, status:pool.status, assignedVehicle:pool.assignedVehicle, optimizedRoute:pool.optimizedRoute } });
});

// ============================================
// CLEANUP (every 5 minutes)
// ============================================
setInterval(() => {
    const now = new Date();
    const beforeRes = rideReservations.length;
    rideReservations = rideReservations.filter(r => !r.expiresAt || now<=new Date(r.expiresAt) || r.status==='completed' || r.status==='in_progress');
    const beforePool = kekePools.length;
    kekePools = kekePools.filter(p => {
        if (p.status==='waiting' && (now-new Date(p.createdAt))/60000>=30) {
            const vIdx = vehicles.findIndex(v => v.id===p.vehicleId);
            if (vIdx!==-1) { vehicles[vIdx].reservedForPool=false; vehicles[vIdx].poolId=null; vehicles[vIdx].available=true; vehicles[vIdx].passengerCount=0; vehicles[vIdx].lastUpdate=new Date().toISOString(); }
            return false;
        }
        return true;
    });
    console.log(`🧹 Cleanup: ${beforeRes-rideReservations.length} expired reservations, ${beforePool-kekePools.length} abandoned pools`);
}, 300000);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status:'healthy', timestamp:new Date().toISOString(),
        vehicles: { total:vehicles.length, available:vehicles.filter(v=>v.available&&v.passengerCount<v.maxCapacity&&!v.reservedForPool).length, full:vehicles.filter(v=>v.passengerCount>=v.maxCapacity).length, reservedForPool:vehicles.filter(v=>v.reservedForPool).length },
        reservations: { total:rideReservations.length, active:rideReservations.filter(r=>r.status==='reserved').length },
        kekePools: { total:kekePools.length, waiting:kekePools.filter(p=>p.status==='waiting').length, ready:kekePools.filter(p=>p.status==='ready').length, inProgress:kekePools.filter(p=>p.status==='in_progress').length },
        serverIP:LOCAL_IP, port:PORT, isMobile:res.locals.isMobile
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ================================================');
    console.log('🚀     BABCOCK CAMPUS NAVIGATOR BACKEND');
    console.log('🚀 ================================================');
    console.log(`📡 Local:   http://localhost:${PORT}`);
    console.log(`📡 Network: http://${LOCAL_IP}:${PORT}`);
    console.log(`\n🗺️  Key endpoints:`);
    console.log(`   /api/vehicles/nearby?lat=6.89&lng=3.72&radius=2`);
    console.log(`   POST /api/kekepool/join  { userName, vehicleId, pickupLat, pickupLng, destinationName, destinationLat, destinationLng }`);
    console.log(`   /api/health`);
    console.log('\n🚲 Vehicle Status:');
    console.log(`   Total: ${vehicles.length} | Available: ${vehicles.filter(v=>v.available&&v.passengerCount<v.maxCapacity&&!v.reservedForPool).length}`);
    console.log('🚀 ================================================\n');
});
