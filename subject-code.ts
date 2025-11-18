interface SubjectCode {
    codeNo: string;
    course: string;
    year: string | number;
    dept : string
}
export interface SubjectGroup {
    subjectId: string;
    subjectTitle: string;
    units: number;
    codes: SubjectCode[];
}   

export interface DepartmentGroup {
  dept: string;
  deptCode: string;
  loadingDepartments: string[];
}

export interface ProgramGroup {
  program: string;
  year: any | number;
  subjects: {
    set: number;
    subjectId: string;
    subjectTitle: string;
    codeNo: string;
   
  }[];
}
export interface ProgramSchedule {
  program: string;
  year: number;
  dept: string;
  subjects: { subjectId: string; subjectTitle: string; codeNo: string;  units: number }[];
  schedule: { [slot: string]: string };
  remainingSubjects?: number;
}


export interface Rooms {
    roomNumber: string;
    schedule: {
        subjectId: string;
        codeNo: string;
        course: string;
        yearLevel: number;
        dept: string;
        day: string;
        time: string;
        units?: number; 
    }[];
}