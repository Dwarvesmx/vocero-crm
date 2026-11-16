"""Registro opcional para Nea; no se importa ni habilita en el agente activo.

Reutiliza CrmClient._request (httpx y BOT_API_KEY existentes). El integrador
inyecta conversación, despacho y mensaje entrante de confianza; nunca el LLM.
Agregar schemas y delegar execute solamente tras autorización de habilitación.
"""
from __future__ import annotations

from hashlib import sha256
from typing import Any

_REF = {"cotizacionId": {"type": "string"}, "version": {"type": "integer", "minimum": 1}}
_LINE = {"type": "object", "properties": {"productoId": {"type": "string"}, "cantidad": {"type": "integer", "minimum": 1, "maximum": 1000}, "baseId": {"type": "string"}}, "required": ["productoId", "cantidad"], "additionalProperties": False}


def _tool(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {"type": "object", "properties": properties, "required": required, "additionalProperties": False}}}


TOOL_SCHEMAS = [
    _tool("comercial_catalogo", "Consulta productos, extras compatibles y condiciones. Orientativo o pendiente no es un precio final autorizado.", {}, []),
    _tool("comercial_preparar", "Prepara cotización con precios calculados por servidor. Solo comunicar como oferta final si estado=aprobada. Si pendiente, es propuesta interna, solicita aprobación y conserva cotizacionId/version.", {"conceptos": {"type": "array", "items": _LINE, "minItems": 1, "maxItems": 40}, "especial": {"type": "string"}}, ["conceptos"]),
    _tool("comercial_solicitar_aprobacion", "Registra solicitud interna; no transfiere ni notifica proactivamente. Retoma al próximo mensaje consultando esta cotización.", _REF, ["cotizacionId", "version"]),
    _tool("comercial_consultar_aprobacion", "Recupera versión y decisión actual de la cotización del prospecto, sin cambiarla.", {"cotizacionId": {"type": "string"}}, ["cotizacionId"]),
    _tool("comercial_aceptar", "Registra aceptación explícita del cliente en su mensaje actual para la versión aprobada indicada. No implica pago.", _REF, ["cotizacionId", "version"]),
    _tool("comercial_contratar", "Crea contratación única de la cotización aceptada; inicialmente pendiente de pago.", _REF, ["cotizacionId", "version"]),
    _tool("comercial_consultar_cobro", "Consulta estado de pago verificado por administración; intención de compra no es pago.", {"cotizacionId": {"type": "string"}}, ["cotizacionId"]),
    _tool("comercial_enlace_cobro", "Recupera exclusivamente el enlace administrativamente aprobado del pedido. Si falta, no inventarlo. Compartirlo usa el envío habitual de Nea.", {"cotizacionId": {"type": "string"}}, ["cotizacionId"]),
]
NAMES = frozenset(t["function"]["name"] for t in TOOL_SCHEMAS)


class ComercialTools:
    def __init__(self, crm: Any, conversation_id: str, dispatch_id: str, inbound_message_id: str, *, enabled: bool = False) -> None:
        self.crm = crm
        self.conversation_id = conversation_id
        self.dispatch_id = dispatch_id
        self.inbound_message_id = inbound_message_id
        self.enabled = enabled

    def schemas(self) -> list[dict[str, Any]]:
        return TOOL_SCHEMAS if self.enabled else []

    async def execute(self, name: str, args: dict[str, Any], tool_call_id: str) -> dict[str, Any]:
        if not self.enabled or name not in NAMES:
            return {"ok": False, "error": "no_disponible"}
        definition = next(t["function"]["parameters"] for t in TOOL_SCHEMAS if t["function"]["name"] == name)
        if set(args) - set(definition["properties"]) or not set(definition["required"]) <= set(args):
            return {"ok": False, "error": "argumentos_invalidos"}
        try:
            if name in {"comercial_catalogo", "comercial_consultar_aprobacion", "comercial_consultar_cobro", "comercial_enlace_cobro"}:
                params = {"conversationId": self.conversation_id}
                if args.get("cotizacionId"):
                    params["cotizacionId"] = args["cotizacionId"]
                response = await self.crm._request("GET", "/api/bot/comercial", params=params)
            else:
                if not tool_call_id or not self.dispatch_id:
                    return {"ok": False, "error": "falta_identidad_operacion"}
                key = sha256((self.dispatch_id + ":" + tool_call_id).encode()).hexdigest()
                action = name.removeprefix("comercial_")
                body = {"action": action, "conversationId": self.conversation_id, "requestKey": key}
                if action == "preparar":
                    body["propuesta"] = args
                else:
                    body.update(args)
                if action == "aceptar":
                    body["mensajeId"] = self.inbound_message_id
                response = await self.crm._request("POST", "/api/bot/comercial", json=body)
            payload = response.json()
            if not 200 <= response.status_code < 300:
                return {"ok": False, "error": payload.get("error", {}).get("code", "crm_error")}
            if name == "comercial_enlace_cobro":
                pedidos = payload.get("pedidos", [])
                pedido = pedidos[0] if pedidos else {}
                return {"ok": True, "enlace": pedido.get("enlace") if pedido.get("estado") not in {"cancelado", "pagado"} else None, "estado": pedido.get("estado", "sin_contratacion")}
            return {"ok": True, "data": payload}
        except Exception:
            # No propagar URL con token, evidencia ni detalles de transporte al modelo.
            return {"ok": False, "error": "crm_no_disponible"}
