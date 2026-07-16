export type AShareSessionPhase = "calibrating"|"closed"|"preauction"|"auction"|"auction-result"|"morning"|"lunch"|"afternoon"|"closing"|"afterhours";
export type AShareSession = { phase:AShareSessionPhase; label:string; live:boolean; tone:string; detail:string };
export function aShareSession(now:Date|null):AShareSession;
