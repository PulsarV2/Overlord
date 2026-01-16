import winston from "winston";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const NODE_ENV = process.env.NODE_ENV || "development";

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
  winston.format.printf((info: any) => {
    const { level, message, timestamp, ...meta } = info;
    let msg = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  }),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: NODE_ENV === "production" ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console({
      stderrLevels: ["error"],
    }),
  ],

  exitOnError: false,
});

if (NODE_ENV === "production") {
  const dataDir = process.env.DATA_DIR || "./data";

  logger.add(
    new winston.transports.File({
      filename: `${dataDir}/error.log`,
      level: "error",
      maxsize: 10485760,
      maxFiles: 5,
    }),
  );

  logger.add(
    new winston.transports.File({
      filename: `${dataDir}/combined.log`,
      maxsize: 10485760,
      maxFiles: 5,
    }),
  );
}

logger.info(`Logger initialized (level: ${LOG_LEVEL}, env: ${NODE_ENV})`);

export default logger;
