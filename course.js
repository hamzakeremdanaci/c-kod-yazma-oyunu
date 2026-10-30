'use strict';

const partA = require('./lessons/01-08.js');
const partB = require('./lessons/09-16.js');

const lessons = partA.concat(partB);

const exerciseIndex = {};
let exerciseCount = 0;
for (const lesson of lessons) {
  for (const ex of lesson.exercises) {
    ex.lessonId = lesson.id;
    ex.lessonTitle = lesson.title;
    exerciseIndex[ex.id] = ex;
    exerciseCount++;
  }
}

module.exports = {
  meta: {
    title: 'C ile Programlamaya Sıfırdan Başlangıç',
    subtitle: 'Hiçbir şey bilmiyormuş gibi başla: her ders okunur, örnek çalıştırılır, alıştırma yazılır.',
    totalLessons: lessons.length,
    exerciseCount,
    levels: ['Temel', 'Temel', 'Orta'],
  },
  lessons,
  exerciseIndex,
  exerciseCount,
};