export { consultarEspacio, guardarEspacio, listarEspacios, consultarPoliticaGlobal, consultarExcepciones, guardarPoliticaGlobal } from "./infra/admin";
export { demoKnowledge, modifyDemoKnowledge, recoverDemoDocument, uploadDemoDocument } from "./infra/knowledge";
export { adminCommand, globalCommand } from "./domain/contracts";
export { simulatorCommand, simulatorRead, SimulatorError } from "./infra/simulator";

export { configuredDemoProvider, realDemoSend, reconcileDemoOperation } from "./infra/finance";
