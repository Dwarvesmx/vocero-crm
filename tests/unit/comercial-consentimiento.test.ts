import {describe,it,expect} from 'vitest';
import {respuestaAviso,respuestaAvisoEnContexto,autorizacionAvisoCompleta,referenciaAvisoExplicita} from '@/server/comercial/consentimiento';

it('INC-01 liga el aviso explícito a una sola cotización y versión',()=>{
  const frase = 'Autorizo que me avises por este WhatsApp cuando se apruebe mi cotización abcdef12, versión 1.';
  expect(referenciaAvisoExplicita(frase)).toEqual({ id: 'abcdef12', version: 1 });
  expect(referenciaAvisoExplicita('Avísame cuando la propuesta abcdef12-aaaa-bbbb-cccc-0123456789ab esté aprobada.')).toBeNull();
  expect(referenciaAvisoExplicita('Te autorizo a notificarme por WhatsApp cuando aprueben la propuesta abcdef12-aaaa-bbbb-cccc-0123456789ab V2.')).toEqual({ id: 'abcdef12-aaaa-bbbb-cccc-0123456789ab', version: 2 });
  expect(referenciaAvisoExplicita('Sí. Cotización abcdef12, versión 1.')).toBeNull();
  expect(referenciaAvisoExplicita(frase.replace('versión 1', 'versión 1.5'))).toBeNull();
  expect(referenciaAvisoExplicita('No '+frase)).toBeNull();
  expect(referenciaAvisoExplicita(frase+' Propuesta fedcba21.')).toBeNull();
  expect(referenciaAvisoExplicita(frase+' Si mantienen el precio.')).toBeNull();
});
describe('Autorización del aviso con preguntas adicionales',()=>{
 it.each(['Sí','Sí, avísame','Sí, avísame cuando se apruebe, pero antes explícame el servicio y precio','Sí, avísame por este WhatsApp cuando se apruebe esta cotización.\nPero antes, ¿qué incluye?'])( 'reconoce autorización textual: %s',texto=>expect(respuestaAviso(texto)).toBe(true));
 it.each(['No','No me avises','Sí, pero no me escribas','Sí avísame solo si bajas el precio','¿Me avisas?','Sí quiero cotizar'])( 'no transforma otra intención en consentimiento: %s',texto=>expect(respuestaAviso(texto)).toBe(false));
});

it('Sí quiero solo confirma una pregunta inequívoca de aviso',()=>{
 const texto='Sí quiero';
 const pregunta='¿Te aviso por este WhatsApp cuando tu cotización esté autorizada?';
 expect(respuestaAvisoEnContexto(texto,pregunta)).toBe(true);
 expect(autorizacionAvisoCompleta(texto)).toBe(false);
 expect(respuestaAvisoEnContexto(texto,'Te aviso sobre la cotización aprobada. ¿Aceptas la propuesta?')).toBe(false);
 expect(respuestaAvisoEnContexto(texto,pregunta+' ¿Aceptas la propuesta?')).toBe(false);
});


it('consentimiento espontáneo con preguntas distingue rechazo explícito',()=>{
 const texto='Quiero cotizar. También autorizo que me avises por este WhatsApp cuando esté aprobada. ¿Cómo contrato?';
 expect(autorizacionAvisoCompleta(texto)).toBe(true);
 expect(autorizacionAvisoCompleta('No autorizo que me avises por este WhatsApp cuando esté aprobada')).toBe(false);
 expect(autorizacionAvisoCompleta('Desautorizo que me avises por este WhatsApp cuando esté aprobada')).toBe(false);
});

it('consentimiento espontáneo reconoce la frase original y excluye negativas y condiciones',()=>{
 const frase='También te autorizo expresamente a avisarme por este WhatsApp cuando la cotización esté aprobada';
 expect(autorizacionAvisoCompleta('Quiero cotizar 12 productos. '+frase+'.')).toBe(true);
 expect(autorizacionAvisoCompleta('No '+frase.toLowerCase()+'.')).toBe(false);
 expect(autorizacionAvisoCompleta(frase+' solo si acepto primero.')).toBe(false);
 expect(autorizacionAvisoCompleta(frase+'. Pero no me avises todavía.')).toBe(false);
});

const preguntaNatural='¿Quieres que te avise por este WhatsApp cuando aprueben tu cotización?';
it.each(['Claro','Va','Porfa','Me avisas','Órale','Está bien'])('acredita %s solo ante pregunta contextual',texto=>{
 expect(respuestaAvisoEnContexto(texto,preguntaNatural)).toBe(true);
 expect(respuestaAvisoEnContexto(texto,'¿Aceptas el precio de la cotización?')).toBe(false);
 expect(respuestaAvisoEnContexto(texto,'¿Quieres que te avise cuando aprueben tu cotización o prefieres contratar ahora?')).toBe(false);
 expect(autorizacionAvisoCompleta(texto)).toBe(false);
});

it('reconoce la autorización autónoma de la segunda prueba sin extrapolar a otro objeto',()=>{
 const texto='Te autorizo expresamente a avisarme por este WhatsApp cuando esta nueva cotización sea aprobada';
 expect(autorizacionAvisoCompleta(texto)).toBe(true);
 expect(autorizacionAvisoCompleta(texto.replace('este WhatsApp','correo'))).toBe(false);
 expect(autorizacionAvisoCompleta(texto.replace('esta nueva','otra'))).toBe(false);
 expect(autorizacionAvisoCompleta(texto+' si mantienes el precio')).toBe(false);
});
