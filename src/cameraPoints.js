import * as THREE from 'three';

// Ogni inquadratura è costruita sul soggetto del capitolo (target sul dettaglio architettonico)
// e verificata contro l'heightfield di basilica + città: spazio libero attorno alla camera e
// linea di vista senza ostacoli fino al soggetto.
export const cameraPoints = [
    {
        position: new THREE.Vector3(91.39, 52.56, 8.79),
        target: new THREE.Vector3(-2.0, 20.0, -6.0),
        kicker: 'Bergamo Alta',
        title: 'Santa Maria Maggiore',
        description: "Voluta dalla città nel 1137 come voto alla Vergine, la basilica romanica domina il cuore di Città Alta. Non ha una facciata: il lato occidentale è addossato al Palazzo Vescovile e si entra dai portali laterali.",
        lighting: 'day',
    },
    {
        position: new THREE.Vector3(63.31, 45.65, -28.24),
        target: new THREE.Vector3(18.7, 38.0, 3.0),
        kicker: 'La torre',
        title: 'Il Campanile',
        description: "Completata nel 1436, la torre campanaria sale a pianta quadrata fino alla cella delle campane, coronata da una cupola in rame dal verde inconfondibile. Le sue campane scandiscono ancora oggi il tempo della città.",
        lighting: 'day',
    },
    {
        position: new THREE.Vector3(-20.22, 49.73, 27.53),
        target: new THREE.Vector3(0.0, 32.0, -7.5),
        kicker: "Il cuore dell'edificio",
        title: 'Il Tiburio',
        description: "Sopra l'incrocio dei bracci si innalza il tiburio ottagonale, alleggerito da una loggetta ad archi e concluso da una lanterna con guglia. Attorno, absidi e tetti in lastre di pietra disegnano la pianta a croce greca.",
        lighting: 'sunset',
    },
    {
        position: new THREE.Vector3(-6.0, 31.81, -62.77),
        target: new THREE.Vector3(-6.0, 8.0, -30.0),
        kicker: "L'ingresso nord",
        title: 'Il Portale dei Leoni Rossi',
        description: "Scolpito da Giovanni da Campione nel 1353, il protiro settentrionale poggia su due leoni stilofori in marmo rosso di Verona. Nella loggetta superiore, la statua equestre di Sant'Alessandro, patrono di Bergamo.",
        lighting: 'sunset',
    },
    {
        position: new THREE.Vector3(-43.74, 18.99, -45.24),
        target: new THREE.Vector3(-20.5, 12.0, -22.0),
        kicker: 'Il mausoleo',
        title: 'La Cappella Colleoni',
        description: "Capolavoro del Rinascimento lombardo, eretta tra il 1472 e il 1476 da Giovanni Antonio Amadeo come mausoleo del condottiero Bartolomeo Colleoni. La facciata alterna marmi bianchi, rossi e neri in un ricamo geometrico.",
        lighting: 'night',
    },
];
