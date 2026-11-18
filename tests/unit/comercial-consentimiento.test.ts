import {describe,it,expect} from 'vitest';
import {respuestaAviso,respuestaAvisoEnContexto,autorizacionAvisoCompleta} from '@/server/comercial/consentimiento';
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
